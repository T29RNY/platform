-- Migration 401 — Venue OS nav Phase 2.5: membership eligibility = club SCOPE, not venue_id=.
--
-- DECISIONS s180 (option 1). Today every membership eligibility gate asks
-- "does this member hold a membership AT THIS venue_id?" — which is wrong for a
-- multi-venue club: a member of a 2-venue club is locked out of the club's OTHER
-- venue. Fix: a membership belongs to the CLUB (venue_memberships.club_id, set on
-- all 23 live rows, 0 club-less), so entitlement resolves across the club's venues
-- (club_id → club_venues), NOT a single venue_id.
--
-- Scope key already exists → NO new column. Cross-CLUB passes (distinct clubs.id,
-- the franchise case) are DEFERRED ENTIRELY (settlement + safeguarding + no demand,
-- not SQL) — the helper below is the single seam that keeps them expressible later.
--
-- Behaviour on TODAY's single-venue data is byte-identical (each club has exactly
-- one venue, and a membership's venue_id is that venue, so "venue in the club's
-- venue set" == "venue_id = target"). The change only ever ADMITS more (a 2nd venue
-- of the same club); it never admits a member of a DIFFERENT club. Proven by EV
-- against a deliberately multi-venue _e2e_ fixture + the single-venue no-op assert.
--
-- Surface = 6 eligibility gates, each with ONE identical venue_memberships predicate
-- (live audit s180): member_book_class_session, member_book_appointment,
-- member_purchase_class_package, member_join_club_team, member_list_trainers (boolean
-- EXISTS gates) + member_get_venue_membership_pass (row SELECT). The other ~9 funcs
-- touching venue_memberships+venue_id key off club_id / audience / own-enrolment
-- venue (NOT eligibility) and are deliberately untouched. Enrolment stays
-- venue-pinned (tier venue_membership_tiers.venue_id NOT NULL — scope is a
-- CONSUMPTION question, not a creation one).
--
-- Method: the 6 bodies are large + load-bearing, so rather than restate them (and
-- risk a transcription bug), each gate's single membership predicate is swapped via
-- a whitespace-tolerant regexp_replace on the LIVE pg_get_functiondef, asserted to
-- match EXACTLY ONCE (else the migration aborts) — the mig-075 precedent. Grants +
-- SECDEF + search_path are preserved by CREATE OR REPLACE. Post-apply baseline diff
-- (verify step) confirms ONLY the predicate changed in each body.
--
-- Consumers (Hard Rule #14): the same consumer/inorout member_* RPC wrappers — return
-- shapes UNCHANGED, so no JS change. Phase 2.5 build cycle, next free mig = 402.

-- ── 1. Scope helpers (the single seam) ───────────────────────────────────────
-- Row-level predicate: does a membership (its club_id + its own venue_id) cover a
-- target venue? Club membership → target ∈ the club's venues (club_venues). Club-less
-- (0 live; defensive) → pinned to its own venue_id (today's behaviour).
CREATE OR REPLACE FUNCTION public._membership_covers_venue(p_club_id text, p_venue_id text, p_target_venue text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_club_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.club_venues cv
      WHERE cv.club_id = p_club_id AND cv.venue_id = p_target_venue)
    ELSE p_venue_id = p_target_venue
  END;
$function$;

-- Boolean entitlement: does this member hold a live (active/ending) membership whose
-- scope covers the target venue? Replaces the inline "EXISTS … venue_id = target"
-- gate in the 5 boolean call-sites.
CREATE OR REPLACE FUNCTION public._member_entitled_at_venue(p_profile uuid, p_target_venue text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_memberships m
    WHERE m.member_profile_id = p_profile
      AND m.status IN ('active','ending')
      AND public._membership_covers_venue(m.club_id, m.venue_id, p_target_venue)
  );
$function$;

REVOKE ALL     ON FUNCTION public._membership_covers_venue(text, text, text) FROM public;
REVOKE ALL     ON FUNCTION public._member_entitled_at_venue(uuid, text)      FROM public;
-- Internal helpers — invoked only from other SECURITY DEFINER gates (which run as
-- owner, so the gates are unaffected). Clients never call them directly.
REVOKE EXECUTE ON FUNCTION public._membership_covers_venue(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._member_entitled_at_venue(uuid, text)      FROM anon, authenticated;

-- ── 2. Swap the 6 gate predicates onto the helper (exactly-once asserted) ─────
DO $mig$
DECLARE
  v_def  text;
  v_new  text;
  v_n    int;
  -- {fn, regex pattern, replacement}. Pattern is whitespace-tolerant (\s+ across
  -- newlines) and anchored on the unique membership predicate in each body.
  v_jobs jsonb := jsonb_build_array(
    jsonb_build_object('fn','member_book_appointment',
      'pat','SELECT EXISTS \(SELECT 1 FROM public\.venue_memberships WHERE member_profile_id = v_profile\.id AND venue_id = v_tr\.venue_id AND status IN \(''active'',''ending''\)\) INTO v_member;',
      'rep','SELECT public._member_entitled_at_venue(v_profile.id, v_tr.venue_id) INTO v_member;'),
    jsonb_build_object('fn','member_book_class_session',
      'pat','IF NOT EXISTS \(SELECT 1 FROM public\.venue_memberships\s+WHERE member_profile_id = v_profile\.id AND venue_id = v_sess\.venue_id\s+AND status IN \(''active'',''ending''\)\) THEN',
      'rep','IF NOT public._member_entitled_at_venue(v_profile.id, v_sess.venue_id) THEN'),
    jsonb_build_object('fn','member_purchase_class_package',
      'pat','IF NOT EXISTS \(SELECT 1 FROM public\.venue_memberships\s+WHERE member_profile_id = v_profile_id AND venue_id = v_pkg\.venue_id AND status IN \(''active'',''ending''\)\) THEN',
      'rep','IF NOT public._member_entitled_at_venue(v_profile_id, v_pkg.venue_id) THEN'),
    jsonb_build_object('fn','member_join_club_team',
      'pat','IF NOT EXISTS \(\s*SELECT 1 FROM public\.venue_memberships m\s+WHERE m\.member_profile_id = v_target AND m\.venue_id = v_venue_id\s+AND m\.status IN \(''active'',''ending''\)\s*\) THEN',
      'rep','IF NOT public._member_entitled_at_venue(v_target, v_venue_id) THEN'),
    jsonb_build_object('fn','member_list_trainers',
      'pat','SELECT EXISTS \(SELECT 1 FROM public\.venue_memberships WHERE member_profile_id = v_profile AND venue_id = p_venue_id AND status IN \(''active'',''ending''\)\) INTO v_member;',
      'rep','SELECT public._member_entitled_at_venue(v_profile, p_venue_id) INTO v_member;'),
    jsonb_build_object('fn','member_get_venue_membership_pass',
      'pat','WHERE member_profile_id = v_profile_id\s+AND venue_id = v_venue_id\s+AND status IN \(''active'', ''ending''\)',
      'rep',E'WHERE member_profile_id = v_profile_id\n    AND public._membership_covers_venue(club_id, venue_id, v_venue_id)\n    AND status IN (''active'', ''ending'')')
  );
  v_job  jsonb;
BEGIN
  FOR v_job IN SELECT * FROM jsonb_array_elements(v_jobs) LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname = (v_job->>'fn')
    ORDER BY p.oid LIMIT 1;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'mig401: function % not found', (v_job->>'fn');
    END IF;

    v_n := (SELECT count(*) FROM regexp_matches(v_def, (v_job->>'pat'), 'g'));
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'mig401: % — expected exactly 1 predicate match, found %', (v_job->>'fn'), v_n;
    END IF;

    v_new := regexp_replace(v_def, (v_job->>'pat'), (v_job->>'rep'), '');
    EXECUTE v_new;
    RAISE NOTICE 'mig401: % rewritten onto scope helper', (v_job->>'fn');
  END LOOP;
END
$mig$;
