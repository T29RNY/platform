-- Migration 137 — Pitch Booking Stage 2a (venue-owned).
-- Mirror pitched fixtures into pitch_occupancy as priority-1 rows.
-- CORE projection only — NO auto-yield of bookings (that's Stage 2b,
-- once pitch_bookings exists).
--
-- Projects only pitch-holding statuses (scheduled/allocated/in_progress/
-- completed) with a pitch + date + kickoff set. Releasing statuses
-- (postponed/void/walkover/forfeit) or a cleared pitch → deactivate the
-- fixture's occupancy row (frees the slot).
--
-- Occupancy length = COALESCE(fixtures.slot_minutes, league_config.slot_minutes, 60)
-- — NEVER match_duration_mins. Range = (date + kickoff) @ Europe/London,
-- half-open [). Fires only on the columns that affect occupancy, so
-- ref-assign / score-only fixture writes don't re-trigger it.

CREATE OR REPLACE FUNCTION public.tg_sync_fixture_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_venue_id text;
  v_lc_slot  int;
  v_slot     int;
  v_start    timestamptz;
BEGIN
  IF NEW.status IN ('scheduled','allocated','in_progress','completed')
     AND NEW.playing_area_id IS NOT NULL
     AND NEW.scheduled_date IS NOT NULL
     AND NEW.kickoff_time IS NOT NULL THEN

    SELECT l.venue_id, lc.slot_minutes
      INTO v_venue_id, v_lc_slot
    FROM competitions c
    JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id
    LEFT JOIN league_config lc ON lc.league_id = l.id
    WHERE c.id = NEW.competition_id;

    v_slot  := COALESCE(NEW.slot_minutes, v_lc_slot, 60);
    v_start := (NEW.scheduled_date + NEW.kickoff_time) AT TIME ZONE 'Europe/London';

    INSERT INTO public.pitch_occupancy (
      playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (
      NEW.playing_area_id, v_venue_id,
      tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'),
      'fixture', NEW.id::text, 1, true)
    ON CONFLICT (source_kind, source_id) DO UPDATE
      SET playing_area_id = EXCLUDED.playing_area_id,
          venue_id        = EXCLUDED.venue_id,
          time_range      = EXCLUDED.time_range,
          priority        = 1,
          active          = true;
  ELSE
    UPDATE public.pitch_occupancy
       SET active = false
     WHERE source_kind = 'fixture' AND source_id = NEW.id::text;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_fixture_occupancy ON public.fixtures;
CREATE TRIGGER sync_fixture_occupancy
  AFTER INSERT OR UPDATE OF status, playing_area_id, scheduled_date, kickoff_time, slot_minutes
  ON public.fixtures
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_fixture_occupancy();

-- One-time backfill of existing pitch-holding fixtures.
INSERT INTO public.pitch_occupancy (
  playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
SELECT f.playing_area_id, l.venue_id,
       tstzrange(
         (f.scheduled_date + f.kickoff_time) AT TIME ZONE 'Europe/London',
         (f.scheduled_date + f.kickoff_time) AT TIME ZONE 'Europe/London'
           + make_interval(mins => COALESCE(f.slot_minutes, lc.slot_minutes, 60)),
         '[)'),
       'fixture', f.id::text, 1, true
FROM public.fixtures f
JOIN public.competitions c ON c.id = f.competition_id
JOIN public.seasons s ON s.id = c.season_id
JOIN public.leagues l ON l.id = s.league_id
LEFT JOIN public.league_config lc ON lc.league_id = l.id
WHERE f.playing_area_id IS NOT NULL
  AND f.scheduled_date IS NOT NULL
  AND f.kickoff_time IS NOT NULL
  AND f.status IN ('scheduled','allocated','in_progress','completed')
ON CONFLICT (source_kind, source_id) DO UPDATE
  SET playing_area_id = EXCLUDED.playing_area_id,
      venue_id        = EXCLUDED.venue_id,
      time_range      = EXCLUDED.time_range,
      priority        = 1,
      active          = true;
