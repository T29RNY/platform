-- 379_fix_fixture_occupancy_tournament_venue.sql
-- BUG FIX (session 172, surfaced while seeding mig 378).
--
-- tg_sync_fixture_occupancy() (AFTER INSERT/UPDATE on fixtures) resolved the venue for
-- the pitch_occupancy row ONLY via the league path:
--     competitions JOIN seasons JOIN leagues  -> leagues.venue_id
-- For TOURNAMENT fixtures (competitions.tournament_event_id set, season_id NULL) those
-- INNER JOINs match no row, so v_venue_id stays NULL and the INSERT into pitch_occupancy
-- violates its venue_id NOT NULL constraint. This means a club admin running
-- club_admin_generate_schedule with playing_area_ids (Event OS Phase 4) would fail to
-- create any tournament fixture that has a pitch — a latent break in tournament scheduling.
--
-- Fix: resolve the venue from the PITCH itself (playing_areas.venue_id), which is the
-- authoritative owner of any pitch_occupancy row and works for league AND tournament
-- fixtures alike. The seasons/leagues joins become LEFT JOINs (still used only to fetch
-- the league_config default slot length, which legitimately doesn't exist for tournaments;
-- v_slot already COALESCEs to 60). The trigger only fires when playing_area_id IS NOT NULL,
-- so pa.venue_id is always present. Behaviour for league fixtures is unchanged
-- (pa.venue_id == leagues.venue_id for a league's own pitch).
--
-- SECURITY DEFINER + search_path pinned, unchanged. No grant changes (trigger fn).

CREATE OR REPLACE FUNCTION public.tg_sync_fixture_occupancy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue_id text;
  v_lc_slot  int;
  v_slot     int;
  v_start    timestamptz;
  v_range    tstzrange;
  v_bk       record;
BEGIN
  IF NEW.status IN ('scheduled','allocated','in_progress','completed')
     AND NEW.playing_area_id IS NOT NULL
     AND NEW.scheduled_date IS NOT NULL
     AND NEW.kickoff_time IS NOT NULL THEN

    -- Venue from the pitch (works for league AND tournament fixtures); league_config
    -- slot length via the league path when this is a league fixture (NULL otherwise).
    SELECT COALESCE(pa.venue_id, l.venue_id), lc.slot_minutes
      INTO v_venue_id, v_lc_slot
    FROM competitions c
    LEFT JOIN seasons s ON s.id = c.season_id
    LEFT JOIN leagues l ON l.id = s.league_id
    LEFT JOIN league_config lc ON lc.league_id = l.id
    LEFT JOIN playing_areas pa ON pa.id = NEW.playing_area_id
    WHERE c.id = NEW.competition_id;

    v_slot  := COALESCE(NEW.slot_minutes, v_lc_slot, 60);
    v_start := (NEW.scheduled_date + NEW.kickoff_time) AT TIME ZONE 'Europe/London';
    v_range := tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)');

    FOR v_bk IN
      SELECT po.id AS occ_id, b.id AS booking_id, b.team_id, b.venue_id
      FROM pitch_occupancy po
      JOIN pitch_bookings b ON b.id = po.source_id::uuid
      WHERE po.playing_area_id = NEW.playing_area_id
        AND po.active
        AND po.source_kind = 'booking'
        AND po.priority > 1
        AND b.status = 'requested'
        AND po.time_range && v_range
    LOOP
      UPDATE pitch_occupancy SET active = false WHERE id = v_bk.occ_id;
      UPDATE pitch_bookings  SET status = 'superseded', superseded_at = now() WHERE id = v_bk.booking_id;
      PERFORM public.notify_venue_change(v_bk.venue_id, 'booking_superseded');
      IF v_bk.team_id IS NOT NULL THEN
        PERFORM public.notify_team_change(v_bk.team_id, 'booking_superseded');
      END IF;
    END LOOP;

    INSERT INTO public.pitch_occupancy (
      playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (NEW.playing_area_id, v_venue_id, v_range, 'fixture', NEW.id::text, 1, true)
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
