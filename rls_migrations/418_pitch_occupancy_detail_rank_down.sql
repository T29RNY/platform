-- 418_pitch_occupancy_detail_rank_down.sql
-- Revert: drop priority_rank from the club_session / club_fixture detail branches.
-- Restores the mig-414 body verbatim.
CREATE OR REPLACE FUNCTION public._pitch_occupancy_detail(p_kind text, p_source_id text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT CASE p_kind
    WHEN 'fixture' THEN (
      SELECT jsonb_build_object('home_team', th.name, 'away_team', ta.name, 'status', f.status,
        'owed', public._venue_source_owed('fixture', p_source_id))
      FROM public.fixtures f
      LEFT JOIN public.teams th ON th.id = f.home_team_id
      LEFT JOIN public.teams ta ON ta.id = f.away_team_id
      WHERE f.id = p_source_id::uuid)
    WHEN 'booking' THEN (
      SELECT jsonb_build_object(
        'team_id', b.team_id, 'team_name', COALESCE(tb.name, b.booked_by_name),
        'kind', b.kind, 'status', b.status, 'series_id', b.series_id,
        'owed', public._venue_source_owed('booking', p_source_id),
        'is_first', NOT EXISTS (
          SELECT 1 FROM public.pitch_bookings b2
          WHERE b2.venue_id = b.venue_id AND b2.id <> b.id AND b2.created_at < b.created_at
            AND ( (b.team_id IS NOT NULL AND b2.team_id = b.team_id)
               OR (b.team_id IS NULL AND b.booked_by_name IS NOT NULL
                   AND lower(b2.booked_by_name) = lower(b.booked_by_name)) )))
      FROM public.pitch_bookings b
      LEFT JOIN public.teams tb ON tb.id = b.team_id
      WHERE b.id = p_source_id::uuid)
    WHEN 'club_session' THEN (
      SELECT jsonb_build_object(
        'title', cs.title, 'session_type', cs.session_type, 'status', cs.status,
        'team_id', cs.team_id, 'team_name', ct.name,
        'venue_id', cs.venue_id, 'venue_name', sv.name,
        'manager_initials', public._club_team_manager_initials(cs.team_id))
      FROM public.club_sessions cs
      LEFT JOIN public.club_teams ct ON ct.id = cs.team_id
      LEFT JOIN public.venues sv ON sv.id = cs.venue_id
      WHERE cs.id = p_source_id::uuid)
    WHEN 'club_fixture' THEN (
      SELECT jsonb_build_object(
        'our_team', COALESCE(cf.club_team_name, ct.name), 'team_id', cf.club_team_id,
        'opponent', cf.opponent_name, 'is_home', cf.is_home, 'status', cf.status,
        'manager_initials', public._club_team_manager_initials(cf.club_team_id))
      FROM public.club_fixtures cf
      LEFT JOIN public.club_teams ct ON ct.id = cf.club_team_id
      WHERE cf.id = p_source_id::uuid)
    ELSE jsonb_build_object('reason', 'maintenance')
  END;
$fn$;
REVOKE ALL     ON FUNCTION public._pitch_occupancy_detail(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public._pitch_occupancy_detail(text, text) FROM anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
