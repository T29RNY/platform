-- 558_coach_pitch_booking_foundation_down.sql — reverse of 558.
-- Restores tg_sync_club_session_occupancy + _pitch_occupancy_detail to their
-- pre-558 (mig 414/417) bodies and drops the coach reader + the new columns.

-- 1. Drop the coach availability reader
DROP FUNCTION IF EXISTS public.club_manager_pitch_availability(uuid, text, date, date);

-- 2. Restore _pitch_occupancy_detail to its mig-414/418 body (no pitch_status/origin/duration keys)
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
        'team_id', cs.team_id, 'team_name', ct.name, 'priority_rank', ct.priority_rank,
        'venue_id', cs.venue_id, 'venue_name', sv.name,
        'manager_initials', public._club_team_manager_initials(cs.team_id))
      FROM public.club_sessions cs
      LEFT JOIN public.club_teams ct ON ct.id = cs.team_id
      LEFT JOIN public.venues sv ON sv.id = cs.venue_id
      WHERE cs.id = p_source_id::uuid)
    WHEN 'club_fixture' THEN (
      SELECT jsonb_build_object(
        'our_team', COALESCE(cf.club_team_name, ct.name), 'team_id', cf.club_team_id,
        'priority_rank', ct.priority_rank,
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

-- 3. Restore tg_sync_club_session_occupancy to its mig-417 body (hard 60, no pitch_status)
CREATE OR REPLACE FUNCTION public.tg_sync_club_session_occupancy()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_venue_id text;
  v_start    timestamptz;
  v_range    tstzrange;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_session' AND source_id = OLD.id::text;
    RETURN OLD;
  END IF;

  IF NEW.status = 'scheduled'
     AND NEW.playing_area_id IS NOT NULL
     AND NEW.scheduled_at IS NOT NULL THEN
    SELECT pa.venue_id INTO v_venue_id FROM public.playing_areas pa WHERE pa.id = NEW.playing_area_id;
    IF v_venue_id IS NULL THEN
      UPDATE public.pitch_occupancy SET active = false
        WHERE source_kind = 'club_session' AND source_id = NEW.id::text;
      RETURN NEW;
    END IF;
    v_start := NEW.scheduled_at;
    v_range := tstzrange(v_start, v_start + make_interval(mins => 60), '[)');
    PERFORM public._reserve_club_occupancy('club_session', NEW.id::text, NEW.playing_area_id, v_venue_id, v_range, NEW.team_id);
  ELSE
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_session' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

-- 4. Drop the new columns (CASCADE the FK on booked_by_profile_id)
ALTER TABLE public.club_sessions
  DROP COLUMN IF EXISTS pitch_status,
  DROP COLUMN IF EXISTS booking_origin,
  DROP COLUMN IF EXISTS booked_by_profile_id,
  DROP COLUMN IF EXISTS duration_mins;

SELECT pg_notify('pgrst', 'reload schema');
