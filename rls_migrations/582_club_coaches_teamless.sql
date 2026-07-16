-- Migration 582: DF Sports PR #5 — Club-level coach roster (NO team) + team-less DBS surfacing
--
-- THE GAP (audited): a club's DBS record (club_staff_dbs, mig 305) is ALREADY
-- club-level & standalone — keyed (member_profile_id, club_id), team-less capable, and
-- venue_upsert_staff_dbs already records it without a team. But the only STAFF LISTING,
-- venue_list_club_staff (mig 305), reaches people ONLY through club_team_managers →
-- club_teams, so a coach with NO team is invisible to Danny's roster. A team-less
-- session coach (DF's whole coaching model — mig 362 open mixed-age sessions) fits
-- neither venue_admins (login staff) nor club_team_managers (team-scoped).
--
-- THE FIX: a club-level coach roster.
--   1. club_coaches — team-less coach/staff association, keyed (club_id, member_profile_id).
--      Forward-designed so DF PR #8's club_coach LOGIN identity extends THIS table
--      (member-profile keyed) rather than minting a second one.
--   2. venue_upsert_club_coach  — add / reactivate a team-less coach (manage_memberships).
--   3. venue_remove_club_coach  — deactivate (idempotent) (manage_memberships).
--   4. venue_list_club_coaches  — the team-less roster + DBS, returned as a SEPARATE
--      array (NEVER null-UNIONed into venue_list_club_staff). SafeguardingBoard keys its
--      youth-DBS warning off cohort_id; a team-less coach has no cohort, so a null-UNION
--      would let a DBS-less coach silently ESCAPE the youth warning (HIGH-SCRUTINY #2 in
--      DF_SPORTS_ONBOARDING_HANDOFF.md). Instead this reader computes serves_youth
--      SERVER-SIDE (club has any youth cohort) so the warning is authoritative and does
--      not depend on a second client read succeeding.
--
-- DBS recording itself reuses the EXISTING venue_upsert_staff_dbs (mig 305) — no new
-- DBS RPC; it is already team-less.
--
-- SECURITY: every function SECURITY DEFINER, search_path pinned to 'public','pg_temp',
-- single overload, venue-token is the credential (resolve_venue_caller validates it),
-- writes gated on the manage_memberships cap (identical to venue_assign_team_manager /
-- venue_upsert_staff_dbs), REVOKE FROM PUBLIC then GRANT to anon+authenticated. Writes
-- INSERT into audit_events (Hard Rule 9). The reader is STABLE + read-only (no audit).

-- ─── 1. club_coaches ─────────────────────────────────────────────────────────

CREATE TABLE public.club_coaches (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id             text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  member_profile_id   uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  role                text        NOT NULL DEFAULT 'coach'
                                  CHECK (role IN ('coach','assistant_coach','session_lead','other')),
  is_active           boolean     NOT NULL DEFAULT true,
  added_by            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, member_profile_id)
);

CREATE INDEX club_coaches_club_idx ON public.club_coaches (club_id);
ALTER TABLE public.club_coaches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_coaches FROM anon, authenticated;

-- ─── 2. venue_upsert_club_coach ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_upsert_club_coach(
  p_token             text,
  p_member_profile_id uuid,
  p_club_id           text,
  p_role              text DEFAULT 'coach'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_coach_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_role NOT IN ('coach','assistant_coach','session_lead','other') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='P0001';
  END IF;

  -- Confirm club is linked to this caller's venue (same gate as club-staff).
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  -- Confirm member profile exists (a session coach need NOT be an enrolled member).
  IF NOT EXISTS (SELECT 1 FROM public.member_profiles WHERE id = p_member_profile_id) THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.club_coaches (club_id, member_profile_id, role, is_active, added_by, created_at, updated_at)
  VALUES (p_club_id, p_member_profile_id, p_role, true, auth.uid(), now(), now())
  ON CONFLICT (club_id, member_profile_id) DO UPDATE SET
    role       = p_role,
    is_active  = true,
    updated_at = now()
  RETURNING id INTO v_coach_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_coach_added', 'club_coach', v_coach_id::text,
          jsonb_build_object('club_id', p_club_id, 'member_profile_id', p_member_profile_id, 'role', p_role));

  RETURN jsonb_build_object('ok', true, 'coach_id', v_coach_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_upsert_club_coach(text, uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_upsert_club_coach(text, uuid, text, text) TO anon, authenticated;

-- ─── 3. venue_remove_club_coach ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_remove_club_coach(
  p_token             text,
  p_member_profile_id uuid,
  p_club_id           text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  -- Confirm club is linked to this caller's venue.
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  UPDATE public.club_coaches
  SET is_active = false, updated_at = now()
  WHERE club_id = p_club_id AND member_profile_id = p_member_profile_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_coach_removed', 'club_coach', p_member_profile_id::text,
          jsonb_build_object('club_id', p_club_id, 'member_profile_id', p_member_profile_id));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_remove_club_coach(text, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_remove_club_coach(text, uuid, text) TO anon, authenticated;

-- ─── 4. venue_list_club_coaches ──────────────────────────────────────────────
--
-- The team-less coach roster + DBS, returned as its OWN array. serves_youth is
-- computed server-side (club has any youth cohort) so the client's youth-DBS
-- warning is authoritative for team-less coaches (who have no cohort_id to match).
-- Over-warns (any youth cohort → serves_youth true) — the SAFE direction for a
-- safeguarding recommendation. Certificate NUMBER is never returned (status/expiry
-- only), matching venue_list_club_staff.

CREATE OR REPLACE FUNCTION public.venue_list_club_coaches(
  p_token   text,
  p_club_id text
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller       record;
  v_venue_id     text;
  v_serves_youth boolean;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Confirm the club is linked to this caller's venue (same gate as club-staff).
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  -- Does this club serve under-18s? (category='youth' or an under-18 max_age band.)
  -- Deliberately NOT filtered on active=true: the client youth set is built from
  -- clubListCohorts(..., include_inactive=true), so a team-scoped coach on an inactive
  -- youth cohort is already flagged. Matching that here keeps team-less coaches consistent
  -- and errs on over-warn (a safeguarding recommendation, never an automatic block).
  SELECT EXISTS (
    SELECT 1 FROM public.club_cohorts
    WHERE club_id = p_club_id
      AND (lower(coalesce(category, '')) = 'youth' OR (max_age IS NOT NULL AND max_age < 18))
  ) INTO v_serves_youth;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'coach_id',          cc.id,
        'member_profile_id', mp.id,
        'first_name',        mp.first_name,
        'last_name',         mp.last_name,
        'role',              cc.role,
        'is_active',         cc.is_active,
        -- explicit team-less markers so client rows that read team/cohort don't choke
        'team_id',           NULL,
        'team_name',         NULL,
        'cohort_id',         NULL,
        'is_session_coach',  true,
        'serves_youth',      v_serves_youth,
        'dbs_id',            dbs.id,
        'dbs_status',        dbs.status,
        'dbs_check_type',    dbs.check_type,
        'dbs_expiry_date',   dbs.expiry_date
      ) ORDER BY mp.first_name, mp.last_name
    )
    FROM public.club_coaches cc
    JOIN public.member_profiles mp ON mp.id = cc.member_profile_id
    LEFT JOIN public.club_staff_dbs dbs
      ON dbs.member_profile_id = cc.member_profile_id AND dbs.club_id = p_club_id
    WHERE cc.club_id = p_club_id
      AND cc.is_active = true
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_list_club_coaches(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_list_club_coaches(text, text) TO anon, authenticated;
