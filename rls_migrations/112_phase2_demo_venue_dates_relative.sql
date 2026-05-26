-- 112_phase2_demo_venue_dates_relative.sql
--
-- Phase 2 (League Mode) — Cycle 2.7a demo venue date reshuffle.
--
-- Mig 110 seeded fixtures with hardcoded dates (2026-06-03 / 06-10 /
-- 06-17). At seed time, the first two weeks were FUTURE dates —
-- which meant the recent / tonight / this_week / upcoming buckets in
-- venue_get_state all landed empty or mis-bucketed. The dashboard
-- panels rendered correctly but showed no data.
--
-- This migration repositions the demo fixtures so:
--   week 1 = current_date - 13 days  → recent (2 completed)
--   week 2 = current_date - 6  days  → recent (walkover + completed)
--   week 3 = current_date + 8  days  → upcoming (2 allocated)
--
-- The season window is also expanded backwards (start_date) so the
-- now-past fixtures still pass the venue_generate_fixtures
-- "within season window" validator if anyone re-seeds.
--
-- Idempotent: works against the existing demo_venue. Future
-- mig 110 reseed (after dropping the demo) will already use
-- CURRENT_DATE-relative arithmetic per the updated source file.

UPDATE seasons
   SET start_date = current_date - 21,
       end_date   = current_date + 56
 WHERE league_id = 'demo_league';

WITH wk AS (
  SELECT f.id, f.week_number,
         CASE f.week_number
           WHEN 1 THEN current_date - 13
           WHEN 2 THEN current_date - 6
           WHEN 3 THEN current_date + 8
         END AS new_date
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  WHERE s.league_id = 'demo_league'
)
UPDATE fixtures f
   SET scheduled_date = wk.new_date
  FROM wk
 WHERE f.id = wk.id;
