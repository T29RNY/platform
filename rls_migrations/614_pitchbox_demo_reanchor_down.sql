-- 614_pitchbox_demo_reanchor_down.sql
--
-- Reverses 614: shifts the Pitchbox Arena demo back to its original 608 anchor,
-- Sat 18 Jul 2026 (the date 608 was applied, and therefore the date every
-- CURRENT_DATE + offset in that seed resolved to).
--
-- Identical mechanics to the up-migration, only the target date differs: the up
-- shifts the first unplayed league round onto CURRENT_DATE, this shifts it back
-- onto 2026-07-18. Scores, statuses, teams, standings, logins and grants are not
-- touched here either — dates only.
--
-- Idempotent: run it twice and the second run computes a delta of 0 and no-ops.

BEGIN;

DO $reanchor_down$
DECLARE
  v_origin      CONSTANT date := DATE '2026-07-18';
  v_season      uuid;
  v_league_comp uuid;
  v_tourn_id    uuid;
  v_tourn_comp  uuid;
  v_anchor      date;
  v_delta       int;
BEGIN
  SELECT id INTO v_season
    FROM public.seasons
   WHERE league_id = 'league_pitchbox'
   ORDER BY start_date DESC
   LIMIT 1;

  SELECT id INTO v_league_comp
    FROM public.competitions
   WHERE season_id = v_season AND type = 'league'
   ORDER BY created_at
   LIMIT 1;

  SELECT id INTO v_tourn_id
    FROM public.tournament_events
   WHERE slug = 'pitchbox-summer-6s';

  SELECT id INTO v_tourn_comp
    FROM public.competitions
   WHERE tournament_event_id = v_tourn_id
   ORDER BY created_at
   LIMIT 1;

  IF v_season IS NULL OR v_league_comp IS NULL OR v_tourn_id IS NULL THEN
    RAISE EXCEPTION 'Pitchbox demo not found — nothing to revert.';
  END IF;

  SELECT MIN(scheduled_date) INTO v_anchor
    FROM public.fixtures
   WHERE competition_id = v_league_comp
     AND status = 'scheduled';

  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'No unplayed Pitchbox league fixtures left to anchor to — cannot revert by date.';
  END IF;

  v_delta := v_origin - v_anchor;

  IF v_delta = 0 THEN
    RAISE NOTICE 'Pitchbox demo already at its original anchor (%). Nothing to do.', v_origin;
    RETURN;
  END IF;

  UPDATE public.fixtures
     SET scheduled_date = scheduled_date + v_delta
   WHERE competition_id = v_league_comp;

  IF v_tourn_comp IS NOT NULL THEN
    UPDATE public.fixtures
       SET scheduled_date = scheduled_date + v_delta
     WHERE competition_id = v_tourn_comp;
  END IF;

  UPDATE public.tournament_events
     SET event_date = event_date + v_delta
   WHERE id = v_tourn_id;

  UPDATE public.seasons
     SET start_date = start_date + v_delta,
         end_date   = end_date   + v_delta
   WHERE id = v_season;

  UPDATE public.pitch_bookings
     SET booking_date = booking_date + v_delta
   WHERE venue_id = 'pitchbox_arena';

  UPDATE public.pitch_occupancy po
     SET time_range = tstzrange(
           (b.booking_date + b.kickoff_time) AT TIME ZONE 'Europe/London',
           (b.booking_date + b.kickoff_time + make_interval(mins => b.slot_minutes))
             AT TIME ZONE 'Europe/London',
           '[)')
    FROM public.pitch_bookings b
   WHERE po.venue_id    = 'pitchbox_arena'
     AND po.source_kind = 'booking'
     AND po.source_id   = b.id::text;

  RAISE NOTICE 'Pitchbox demo reverted by % day(s) to its original % anchor.', v_delta, v_origin;
END
$reanchor_down$;

COMMIT;
