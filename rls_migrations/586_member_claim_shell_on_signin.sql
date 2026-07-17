-- 586_member_claim_shell_on_signin.sql
--
-- DF Sports Onboarding — PR #4b. Let an imported family actually GET IN.
--
-- THE BUG. superadmin_import_club_roster (mig 581) mints UNCLAIMED shells
-- (auth_user_id NULL by design — the import grants nobody access) and its header
-- asserts "a guardian claims their profile later via the existing email-match
-- sign-in flow (member_claim_profile)". That flow does not exist:
-- member_claim_profile (mig 570) is wrapped + exported but has ZERO app callers,
-- and it is the ONLY function that can set auth_user_id on an existing profile.
-- Meanwhile member_self_create_profile never looks for a claimable shell — it
-- INSERTs a new row — so an imported parent who signs up becomes a DUPLICATE
-- person while their real child stays orphaned on the shell. Silently.
--
-- WHY AT SIGN-IN, NOT IN THE SIGNUP WIZARD. MembershipSignup.jsx (the only caller
-- of member_self_create_profile) is reachable ONLY via /q/<code> → InviteResolve →
-- VenueLanding. An imported parent told "download the app and sign in" NEVER
-- reaches it — they land on the squad-less welcome screen. So the claim has to run
-- on boot, exactly where mig 564's venue_claim_memberships claims an admin's
-- pending invite. This RPC is that, for members. App.jsx calls it in the same
-- Promise.allSettled, BEFORE getMyWorld(), so a freshly-claimed profile is in the
-- very first resolve.
--
-- HOW THE CLAIMING BOOT ACTUALLY ROUTES (do not "tidy" this — it is subtle).
-- `relationships` (the ONLY input to homeScreenType) is loaded by a SEPARATE
-- App.jsx effect that fires in the same commit as this claim and is never
-- re-fetched. So on the claiming boot it reads a PRE-claim snapshot: guardian_of is
-- [] and homeScreenType is 'squad_only', NOT 'parent'. The parent still lands
-- correctly only because getMyWorld() IS post-claim → guardian hat → hubEligible →
-- the squad_only + 0-destination + hubEligible arm (mig-568's landing fix) sends
-- them to /hub. The reload then re-reads everything post-claim, so boot 2 is a
-- genuine 'parent'. Net: correct, but it leans on an arm added for a different
-- reason. Hardening (refresh `relationships` when this returns claimed:true) is
-- tracked in BUGS.md rather than done here, to keep this diff to one increment.
--
-- THE CLAIMABLE-SHELL RULE (operator-decided 2026-07-16). Claim only when EXACTLY
-- ONE candidate matches; 0 → no-op (member_self_create_profile still creates as
-- today); 2+ → claim NOTHING, audit it, surface to the operator. Never guess: a
-- wrong claim hands over a child's medical + consent record, and
-- get_user_relationships resolves the caller with `WHERE auth_user_id = v_uid
-- LIMIT 1`, so a wrong claim would fail SILENTLY.
--
-- THREE TRAPS THIS DELIBERATELY AVOIDS (all confirmed against live data):
--  1. NEVER trust a client-supplied email. MembershipSignup.jsx:158 pre-fills the
--     login email but lets the user EDIT it, and member_self_create_profile takes
--     p_email from the client. Matching on that would let anyone claim a stranger's
--     child by typing their address. This RPC takes NO parameters and reads
--     auth.users.email for auth.uid() — and requires email_confirmed_at, so an
--     unverified address can never claim anything.
--  2. An email match is genuinely AMBIGUOUS — a family email sits on the parent AND
--     the child (live: bennett.family@example.com → Claire Bennett + Leo Bennett,
--     13). Hence the exactly-one rule + the age gate below, which together collapse
--     that real case to the mother alone.
--  3. ⛔ The obvious discriminator is BANNED. "Has a member_guardians row → is a
--     child → not claimable" is the exact rule mig 583 shipped and mig 584
--     OPERATOR-CORRECTED: DF's 16-yo coaches are academy graduates who legitimately
--     have guardians on file, and it silently minted DUPLICATE people. So the gate
--     here is AGE (dob NULL or >= 16, mirroring mig 584's coach_must_be_16), never
--     the presence of a guardian link. Do not "simplify" this back.
--
-- KNOWN, DELIBERATELY OUT OF SCOPE (see BUGS.md / handoff PR #4b):
--  * Cross-club shells. The importer matches a guardian by email WITHIN one club,
--    so a parent with kids at two clubs gets TWO shells while the model assumes one
--    profile per person. Those two shells make this RPC return 'ambiguous' → it
--    claims nothing and audits, which is the safe failure. Single-club DF is
--    unaffected. Merging cross-club people is its own scope.
--  * A parent who ALREADY has a claimed profile before being imported gets a new
--    shell from the import (it dedups only among that club's guardian links). This
--    RPC no-ops for them ('already_linked'). Also its own scope.
--
-- SECURITY — mirrors mig 578 / 581:
--  * SECURITY DEFINER, search_path pinned (public, pg_temp).
--  * Takes NO parameters — nothing about the caller is client-supplied.
--  * anon REVOKEd BY NAME (Supabase default-privileges auto-grant anon; REVOKE FROM
--    PUBLIC does not strip it).
--  * Idempotent + best-effort: never raises on the no-op paths, so a boot-time
--    caller can fire-and-forget without ever bricking the launch.
--  * Audit row on every OUTCOME that changes or refuses state (Hard Rule 9).
--
-- Paired teardown: 586_member_claim_shell_on_signin_down.sql

CREATE OR REPLACE FUNCTION public.member_claim_shell_on_signin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_email      text;
  v_confirmed  timestamptz;
  v_n          int;
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'claimed', false, 'reason', 'not_authenticated');
  END IF;

  -- Already linked → nothing to claim. The overwhelmingly common path.
  IF EXISTS (SELECT 1 FROM public.member_profiles WHERE auth_user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'already_linked');
  END IF;

  -- VERIFIED email only (trap 1). Unconfirmed → claim nothing.
  SELECT lower(btrim(u.email)), u.email_confirmed_at
    INTO v_email, v_confirmed
  FROM auth.users u WHERE u.id = v_uid;

  IF v_email IS NULL OR v_email = '' OR v_confirmed IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'no_verified_email');
  END IF;

  -- Candidates: unclaimed + verified-email match + NOT a young child (trap 3 — age,
  -- never a member_guardians exclusion).
  -- ONE statement, so the count and the pick share ONE snapshot. Counting and then
  -- re-SELECTing would read two snapshots under READ COMMITTED: a concurrent
  -- superadmin_import_club_roster re-run (plausible — the operator may import the
  -- real roster while families are signing in) could add a second candidate in
  -- between, and `SELECT ... INTO` does NOT raise on multiple rows (only INTO
  -- STRICT does) — it would silently take an arbitrary one. That is precisely the
  -- "never guess" invariant this RPC exists to enforce, and a wrong bind is silent
  -- because get_user_relationships resolves the caller with LIMIT 1.
  SELECT count(*), (array_agg(mp.id ORDER BY mp.created_at))[1]
    INTO v_n, v_profile_id
  FROM public.member_profiles mp
  WHERE mp.auth_user_id IS NULL
    AND lower(btrim(mp.email)) = v_email
    AND (mp.dob IS NULL OR date_part('year', age(mp.dob))::int >= 16);

  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'no_match');
  END IF;

  -- Ambiguous (trap 2) → claim NOTHING and leave a server-side trace for the
  -- operator. Guessing here could hand an adult a child's medical record.
  IF v_n > 1 THEN
    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (
      '_system', v_uid, 'player', v_uid::text,
      'member_shell_claim_ambiguous', 'member_profile', NULL,
      jsonb_build_object('email', v_email, 'candidates', v_n)
    );
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'ambiguous', 'candidates', v_n);
  END IF;

  -- v_profile_id already resolved above, in the same snapshot as the count.
  UPDATE public.member_profiles
  SET auth_user_id = v_uid, updated_at = now()
  WHERE id = v_profile_id
    AND auth_user_id IS NULL;   -- re-assert under the write; never steal a claimed row

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'race_lost');
  END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player', v_uid::text,
    'member_shell_claimed_on_signin', 'member_profile', v_profile_id::text,
    jsonb_build_object('email', v_email, 'profile_id', v_profile_id)
  );

  RETURN jsonb_build_object('ok', true, 'claimed', true, 'profile_id', v_profile_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.member_claim_shell_on_signin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_claim_shell_on_signin() FROM anon;
GRANT EXECUTE ON FUNCTION public.member_claim_shell_on_signin() TO authenticated;
