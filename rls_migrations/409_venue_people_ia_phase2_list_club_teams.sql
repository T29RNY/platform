-- 409_venue_people_ia_phase2_list_club_teams.sql
--
-- Venue People & Spaces IA — Phase 2 (Teams page).
--
--   venue_list_club_teams(p_venue_token) -> { ok, teams:[...] }
--
-- Venue-wide club-teams reader: every club team across ALL clubs linked to the
-- caller's venue (via club_venues), with its age group + member count. Powers the
-- "Club teams" tab on the new combined Teams page. Read-only; no audit.
-- Ownership rolls up club_teams.club_id -> club_venues.venue_id (NOT the league
-- path). Excludes soft-archived teams (archived_at IS NULL), mirroring the org
-- chart default. Single overload; SECURITY DEFINER; search_path pinned;
-- granted anon + authenticated (venue_* gotcha).
--
-- Consumer: apps/venue Teams page (DashboardCOMBINED.teams -> ClubTeamsTab).

CREATE OR REPLACE FUNCTION public.venue_list_club_teams(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_teams jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id',         ct.id,
    'club_id',         ct.club_id,
    'club_name',       cl.name,
    'cohort_id',       ct.cohort_id,
    'cohort_name',     cc.name,
    'cohort_category', cc.category,
    'name',            ct.name,
    'gender',          ct.gender,
    'priority_rank',   ct.priority_rank,
    'member_count',    (SELECT count(*) FROM public.club_team_members m
                          WHERE m.team_id = ct.id AND COALESCE(m.is_active, true)),
    'created_at',      ct.created_at
  ) ORDER BY cl.name, cc.name, ct.priority_rank NULLS LAST, ct.name), '[]'::jsonb)
  INTO v_teams
  FROM public.club_venues cv
  JOIN public.clubs cl       ON cl.id = cv.club_id
  JOIN public.club_teams ct  ON ct.club_id = cv.club_id
  JOIN public.club_cohorts cc ON cc.id = ct.cohort_id
  WHERE cv.venue_id = v_venue_id
    AND ct.archived_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_club_teams(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_club_teams(text) TO anon, authenticated;
