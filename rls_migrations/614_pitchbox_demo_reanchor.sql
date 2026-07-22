-- 614_pitchbox_demo_reanchor.sql
--
-- Re-anchor the Pitchbox Arena demo so "tonight" is always match night.
--
-- WHY: 608 seeded every date as CURRENT_DATE + offset, which froze the whole demo
-- to its apply date (Sat 18 Jul 2026). Four days later the console greeted the
-- operator with "Floodlights down. No fixtures scheduled here tonight.", the
-- three week-4 fixtures were stranded (past-dated but still 'scheduled', so they
-- appeared in NO console list — not This week, not Upcoming, not Recent results),
-- and the tournament was badged "Live" while dated the previous Saturday.
-- The demo therefore degraded a little more every day it wasn't shown.
--
-- WHAT THIS DOES: shifts EVERY Pitchbox date by one uniform delta, chosen so the
-- first unplayed league round lands on today. Relative spacing is preserved, so:
--   weeks 1-3  -> today-21 / -14 / -7, still 'completed'  (League Table unchanged)
--   week 4     -> TODAY, still 'scheduled'                (Tonight + "Enter result")
--   week 5     -> today+7, still 'scheduled'              (Upcoming)
--   tournament -> today, still 'live'                     ("LIVE NOW" becomes true)
--   bookings   -> shifted by the same delta               (calendar stays populated)
--
-- RE-RUNNABLE BY DESIGN. The delta is derived from the data each run, not hardcoded,
-- so this can be applied again on the morning of any demo. Run on the same day twice
-- and the delta is 0 — a no-op. Run it a month later and it catches up in one shot.
-- This is the intended operating procedure: re-run it the morning of the demo.
--
-- SCOPE / SAFETY: every statement is keyed to Pitchbox by stable text ids
-- (venue 'pitchbox_arena', league 'league_pitchbox', tournament slug
-- 'pitchbox-summer-6s') and resolved inside the block — no UUID is hardcoded, and
-- no other venue's rows are readable by any predicate here. Scores, statuses,
-- teams, standings, logins, grants and tokens are NOT touched: this migration
-- moves dates and nothing else.
--
-- OCCUPANCY: fixtures carry an AFTER UPDATE OF scheduled_date trigger
-- (sync_fixture_occupancy), so fixture occupancy re-syncs itself. Bookings have NO
-- such trigger, so their pitch_occupancy rows are REBUILT from the shifted booking
-- rows rather than offset by an interval. That matters: rebuilding from
-- (booking_date + kickoff_time) AT TIME ZONE 'Europe/London' preserves the wall
-- clock (an 18:00 booking stays 18:00) even when the shift crosses a BST/GMT
-- change, whereas adding an interval to a tstzrange would silently drift an hour.
--
-- NOT CHANGED (deliberate): leagues.day_of_week is still 1 (Monday) while the
-- fixtures land on whatever weekday the re-anchor runs. Aligning it would also
-- change how "Set up new season" generates future fixtures, which is a behaviour
-- change this demo-data migration has no business making. Cosmetic only; run the
-- re-anchor on a Monday and the badge lines up for free.
--
-- Reversible: 614_..._down.sql shifts everything back to the original 18 Jul anchor.

BEGIN;

DO $reanchor$
DECLARE
  v_season      uuid;
  v_league_comp uuid;
  v_tourn_id    uuid;
  v_tourn_comp  uuid;
  v_anchor      date;
  v_delta       int;
  v_fx          int;
  v_bk          int;
  v_occ         int;
BEGIN
  -- Resolve every id from stable text keys, so this survives a re-seed.
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
    RAISE EXCEPTION 'Pitchbox demo not found (season=%, league_comp=%, tournament=%) — is 608 applied?',
      v_season, v_league_comp, v_tourn_id;
  END IF;

  -- Anchor = the first still-unplayed league round. That is the round we want to
  -- become "tonight". Using MIN(scheduled) rather than a hardcoded week number means
  -- that if a demo completes week 4, the next run promotes week 5 instead.
  SELECT MIN(scheduled_date) INTO v_anchor
    FROM public.fixtures
   WHERE competition_id = v_league_comp
     AND status = 'scheduled';

  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'No unplayed Pitchbox league fixtures left to anchor to — the demo season is fully played; re-seed via 608 instead.';
  END IF;

  v_delta := CURRENT_DATE - v_anchor;

  IF v_delta = 0 THEN
    RAISE NOTICE 'Pitchbox demo already anchored to today (%). Nothing to do.', CURRENT_DATE;
    RETURN;
  END IF;

  -- 1. League fixtures (trigger re-syncs their occupancy).
  UPDATE public.fixtures
     SET scheduled_date = scheduled_date + v_delta
   WHERE competition_id = v_league_comp;
  GET DIAGNOSTICS v_fx = ROW_COUNT;

  -- 2. Tournament group-stage fixtures (playing_area_id is NULL on these, so they
  --    hold no occupancy rows — nothing to re-sync).
  IF v_tourn_comp IS NOT NULL THEN
    UPDATE public.fixtures
       SET scheduled_date = scheduled_date + v_delta
     WHERE competition_id = v_tourn_comp;
  END IF;

  -- 3. The tournament event itself, so "LIVE NOW" is truthful.
  UPDATE public.tournament_events
     SET event_date = event_date + v_delta
   WHERE id = v_tourn_id;

  -- 4. Season window, so the league still reads as in-season.
  UPDATE public.seasons
     SET start_date = start_date + v_delta,
         end_date   = end_date   + v_delta
   WHERE id = v_season;

  -- 5. Pitch bookings.
  UPDATE public.pitch_bookings
     SET booking_date = booking_date + v_delta
   WHERE venue_id = 'pitchbox_arena';
  GET DIAGNOSTICS v_bk = ROW_COUNT;

  -- 6. Rebuild booking occupancy FROM the shifted bookings (not an interval offset)
  --    so wall-clock times survive a BST/GMT boundary.
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
  GET DIAGNOSTICS v_occ = ROW_COUNT;

  RAISE NOTICE 'Pitchbox demo re-anchored by % day(s) to %: % league fixtures, % bookings, % occupancy rows.',
    v_delta, CURRENT_DATE, v_fx, v_bk, v_occ;
END
$reanchor$;

COMMIT;
