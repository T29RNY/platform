-- Migration 583: DF Sports PR #5c — venue-token "create a brand-new session coach"
--
-- THE GAP (audited): PR #5b (ClubAdminPeople write-UI, mig 582 consumer) can only
-- PICK an existing member_profile to make a session coach. A DF session coach is
-- often NOT an enrolled member (mig 582 line 88: "a session coach need NOT be an
-- enrolled member"), so there must be a way to add a brand-new person. But there is
-- NO venue-token RPC that mints a member_profile:
--   • member_create_profile (mig ~282) is gated on venue_admins WHERE user_id=auth.uid()
--     (a RAW venue_id + auth.uid() path, NO manage_memberships cap check, and it does
--     NOT create the club_coaches row — so a client 2-step create-then-add is non-atomic
--     and risks an ORPHAN profile if the second call fails).
--   • venue_create_customer writes venue_customers (a DIFFERENT person table) → customer_id.
--   • member_self_create_profile / member_register_child are auth.uid()-self paths.
--   • superadmin_import_club_roster is is_platform_admin()-only.
--
-- THE FIX: one atomic RPC on the SAME surface as venue_upsert_club_coach (mig 582) —
-- venue token via resolve_venue_caller + manage_memberships cap + club∈venue gate —
-- that in a single transaction:
--   1. REUSES an existing member_profile by email — but ONLY a person already in THIS
--      club (a member via venue_memberships, or already a club_coach) AND only when the
--      match is UNAMBIGUOUS (exactly one such profile). This is deliberately NOT a global
--      member_profiles lookup: a global email match would (a) be a cross-tenant existence
--      oracle + name-disclosure of anyone platform-wide via the returned `reused` flag +
--      the coach roster, and (b) with no unique constraint on email, silently attach the
--      OLDEST match — which on a shared family email could be a CHILD — to the coach
--      roster. Scoping to this club's own people + single-match closes both (adversarial
--      security review, PR #5c). Anything else (no match / stranger's email / ambiguous
--      shared email) → a fresh IDENTITY-ONLY shell is minted instead.
--      The shell: first_name required; last/email/phone optional.
--      NO consent / medical / auth columns are EVER set — a session coach is staff, not
--      an enrolled child; those columns keep their table defaults (false/{}/null), and
--      the profile carries no login (auth_user_id NULL → the mig-371 person_id trigger,
--      which fires only ON auth_user_id, does not run). This mirrors member_create_profile's
--      minimal insert set exactly.
--   2. UPSERTs the club_coaches row (reactivate-or-insert), identical to venue_upsert_club_coach.
--   3. Audits both writes (Hard Rule 9) and returns {ok, coach_id, member_profile_id, reused}.
--
-- DBS is unchanged — still recorded separately via venue_upsert_staff_dbs (team-less),
-- and the youth-DBS warning (mig 582 serves_youth) fires for a new DBS-less coach exactly
-- as before. No consent/medical data is captured here.
--
-- SECURITY: SECURITY DEFINER, search_path pinned to 'public','pg_temp', single overload,
-- venue token is the credential (resolve_venue_caller validates it), manage_memberships
-- gate (identical to venue_upsert_club_coach / venue_upsert_staff_dbs), REVOKE FROM PUBLIC
-- then GRANT to anon+authenticated.

CREATE OR REPLACE FUNCTION public.venue_create_coach_profile(
  p_token       text,
  p_club_id     text,
  p_first_name  text,
  p_last_name   text DEFAULT NULL,
  p_email       text DEFAULT NULL,
  p_phone       text DEFAULT NULL,
  p_role        text DEFAULT 'coach'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_first    text := NULLIF(btrim(p_first_name), '');
  v_last     text := NULLIF(btrim(p_last_name), '');
  v_email    text := NULLIF(lower(btrim(p_email)), '');
  v_phone    text := NULLIF(btrim(p_phone), '');
  v_profile  uuid;
  v_ids      uuid[];
  v_coach_id uuid;
  v_reused   boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name_required' USING ERRCODE='P0001';
  END IF;
  IF p_role NOT IN ('coach','assistant_coach','session_lead','other') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='P0001';
  END IF;

  -- Confirm the club is linked to this caller's venue (same gate as club-staff).
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  -- Reuse an existing member_profile by email (no duplicate person); else mint a
  -- lightweight identity-only shell. Consent/medical/auth columns are NEVER set.
  -- Reuse ONLY a member_profile already tied to THIS club (member or coach), and
  -- ONLY when the match is unambiguous (exactly one). Never a global email lookup —
  -- see the header note (cross-tenant enumeration + shared-family-email minor-attach).
  IF v_email IS NOT NULL THEN
    SELECT array_agg(mp.id) INTO v_ids
    FROM public.member_profiles mp
    WHERE lower(mp.email) = v_email
      -- A coach is never a minor: never reuse a child's profile onto the coach roster,
      -- even on a shared family email that uniquely matches the child (PR #5c security
      -- review, LOW residual). Excluded by dob AND by any guardian link. If the only
      -- in-club email match is a minor, a fresh adult shell is minted instead.
      AND (mp.dob IS NULL OR mp.dob <= current_date - interval '18 years')
      AND NOT EXISTS (SELECT 1 FROM public.member_guardians mg WHERE mg.child_profile_id = mp.id)
      AND (
        EXISTS (SELECT 1 FROM public.venue_memberships vm
                 WHERE vm.member_profile_id = mp.id
                   AND vm.club_id = p_club_id
                   AND vm.status <> 'cancelled')
        OR EXISTS (SELECT 1 FROM public.club_coaches cc
                    WHERE cc.member_profile_id = mp.id
                      AND cc.club_id = p_club_id)
      );
    IF v_ids IS NOT NULL AND array_length(v_ids, 1) = 1 THEN
      v_profile := v_ids[1];
    END IF;
  END IF;

  IF v_profile IS NOT NULL THEN
    v_reused := true;
  ELSE
    INSERT INTO public.member_profiles (first_name, last_name, email, phone)
    VALUES (v_first, v_last, v_email, v_phone)
    RETURNING id INTO v_profile;

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'member_profile_created', 'member_profile', v_profile::text,
            jsonb_build_object('via', 'club_coach_create', 'club_id', p_club_id, 'has_email', v_email IS NOT NULL));
  END IF;

  -- Upsert the club_coaches row (identical to venue_upsert_club_coach).
  INSERT INTO public.club_coaches (club_id, member_profile_id, role, is_active, added_by, created_at, updated_at)
  VALUES (p_club_id, v_profile, p_role, true, auth.uid(), now(), now())
  ON CONFLICT (club_id, member_profile_id) DO UPDATE SET
    role       = p_role,
    is_active  = true,
    updated_at = now()
  RETURNING id INTO v_coach_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_coach_added', 'club_coach', v_coach_id::text,
          jsonb_build_object('club_id', p_club_id, 'member_profile_id', v_profile, 'role', p_role, 'created_profile', NOT v_reused));

  RETURN jsonb_build_object('ok', true, 'coach_id', v_coach_id, 'member_profile_id', v_profile, 'reused', v_reused);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_create_coach_profile(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_create_coach_profile(text, text, text, text, text, text, text) TO anon, authenticated;
