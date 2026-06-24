-- Migration 420 — Calendar & Mobile Phase 3a
-- Member/manager-facing READ-ONLY reader for Club Leagues fixtures (club_fixtures,
-- operator-created). Folds the caller's managed-team fixtures into the inorout
-- manager Agenda alongside club_sessions. Read-only: no writes, no audit row needed.
-- Managed-team resolution mirrors club_manager_list_bump_proposals.
--
-- Consumers (Hard Rule #14): apps/inorout SessionsScreen.jsx manager Agenda (Phase 3a).
-- Designed so Phase 3b (club_manager_update_home_fixture) edits the same fixtures in place.

CREATE OR REPLACE FUNCTION public.member_list_club_fixtures(p_club_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'fixture_id',      cf.id,
        'is_fixture',      true,
        'league_id',       cf.league_id,
        'league_name',     cl.name,
        'club_team_id',    cf.club_team_id,
        'team_id',         cf.club_team_id,            -- alias for managed-team matching
        'club_team_name',  cf.club_team_name,
        'opponent_name',   cf.opponent_name,
        'is_home',         cf.is_home,
        'home_away',       CASE WHEN cf.is_home THEN 'home' ELSE 'away' END,
        'session_type',    'match',
        'title',           'vs ' || cf.opponent_name,
        'scheduled_date',  cf.scheduled_date,
        'kickoff_time',    cf.kickoff_time,
        -- synthesized instant for day-grouping/sorting; kickoff_time is a UK wall-clock,
        -- so anchor it to Europe/London before handing the client a timestamptz.
        'scheduled_at',    CASE WHEN cf.scheduled_date IS NULL THEN NULL
                                ELSE (cf.scheduled_date + COALESCE(cf.kickoff_time, TIME '00:00'))
                                       AT TIME ZONE 'Europe/London' END,
        'playing_area_id', cf.playing_area_id,
        'pitch_name',      pa.name,
        'venue_id',        pa.venue_id,
        'venue_name',      v.name,
        'ref_name',        cf.ref_name,
        'status',          cf.status,
        'share_code',      cf.share_code,
        'notes',           cf.notes
      ) ORDER BY cf.scheduled_date NULLS LAST, cf.kickoff_time NULLS LAST
    )
    FROM public.club_fixtures cf
    JOIN public.club_teams ct
      ON ct.id = cf.club_team_id AND ct.club_id = p_club_id
    JOIN public.club_team_managers ctm
      ON ctm.team_id = cf.club_team_id
     AND ctm.member_profile_id = v_profile_id
     AND ctm.is_active = true
    LEFT JOIN public.club_leagues  cl ON cl.id = cf.league_id
    LEFT JOIN public.playing_areas pa ON pa.id = cf.playing_area_id
    LEFT JOIN public.venues        v  ON v.id  = pa.venue_id
    WHERE cf.status = 'scheduled'
      AND (cf.scheduled_date IS NULL OR cf.scheduled_date >= current_date)
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.member_list_club_fixtures(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_list_club_fixtures(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.member_list_club_fixtures(text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
