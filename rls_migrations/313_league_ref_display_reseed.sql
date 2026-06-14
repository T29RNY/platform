-- =============================================================================
-- Migration 313: League / Ref / Reception Display demo reseed
-- =============================================================================
-- Three things:
--   1. Roll stale fixture dates forward — in_progress ones move to today so
--      the live_scores display zone shows active matches; upcoming allocated
--      ones get relative future dates so the 'upcoming' panel fills.
--   2. Seed match_events (goals + cards) on 4 completed fixtures so the
--      goals_ticker display zone has real content.
--   3. Pin a featured fixture in demo_venue's display_config.
--
-- ALL writes are scoped to fixtures in 'demo_league' / 'Demo Competitive League'
-- competitions and to the 'demo_venue' display config.
-- =============================================================================

-- ─── Guard ────────────────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leagues WHERE id = 'demo_league') THEN
    RAISE EXCEPTION 'demo_league not found — aborting mig 313';
  END IF;
END $guard$;

-- ─── 1. Roll in_progress fixtures to today ───────────────────────────────────
-- These two Demo Competitive League fixtures have been stuck on Jun 10.
-- Moving scheduled_date to today makes them appear in the "tonight" bucket.
UPDATE fixtures
SET    scheduled_date = current_date
WHERE  id IN (
  '92e4be46-04e5-4635-96aa-43d98e9a3b5c',  -- Demo Athletic vs Competitive FC
  'f42d82ef-7dd5-43af-a272-e636dba6cd11'   -- Demo Rovers vs Demo City
)
AND status = 'in_progress';

-- Also roll the Summer League in_progress fixture to today
UPDATE fixtures
SET    scheduled_date = current_date
WHERE  id = '4db5873b-ea94-4c01-b4c1-230f592ea11a'  -- Bravo Athletic vs Charlie City
AND    status = 'in_progress';

-- ─── 2. Roll upcoming allocated/scheduled fixtures to future dates ────────────
-- Summer League upcoming: current_date + 7
UPDATE fixtures
SET    scheduled_date = current_date + 7
WHERE  id IN (
  '732c354a-5e5e-40ef-abe4-f7de2bfa1001',  -- Alpha United vs Bravo Athletic (allocated)
  'db6f21af-f7f4-464d-a409-0c66aec453d7'   -- Charlie City vs Delta FC (allocated)
)
AND    status IN ('allocated', 'scheduled');

-- Demo Competitive League upcoming: current_date + 7
UPDATE fixtures
SET    scheduled_date = current_date + 7
WHERE  id IN (
  'dc000000-0000-4000-8000-0000000000f5',  -- Competitive FC vs Demo Athletic (allocated)
  'dc000000-0000-4000-8000-0000000000f6'   -- Demo Rovers vs Demo City (scheduled)
)
AND    status IN ('allocated', 'scheduled');

-- ─── 3. Seed match_events on completed fixtures ───────────────────────────────
-- Goals seeded with player_name_override (no player_registration rows needed).
-- Covers the 4 most recent completed Summer League + Competitive fixtures.
-- ref_token used as recorded_by_token (the ref who'd have entered these).

-- Fixture e7af0584: Alpha United vs Delta FC, Jun 3 19:30 (Summer League, completed)
INSERT INTO match_events
  (fixture_id, team_id, player_name_override, event_type, minute, period,
   recorded_by_token, recorded_by_type, local_timestamp)
VALUES
  ('e7af0584-5356-45a9-b227-2a62f8dcbff2', 'team_demo_alpha', 'J. Okonkwo',  'goal',        12, 'first_half',  'e1e09eda-c2a1-41c9-aa17-c42de0f7e976', 'referee', '2026-06-03 19:42:00+00'),
  ('e7af0584-5356-45a9-b227-2a62f8dcbff2', 'team_demo_alpha', 'B. Clarke',   'goal',        34, 'first_half',  'e1e09eda-c2a1-41c9-aa17-c42de0f7e976', 'referee', '2026-06-03 20:04:00+00'),
  ('e7af0584-5356-45a9-b227-2a62f8dcbff2', 'team_demo_delta', 'R. Mensah',   'goal',        58, 'second_half', 'e1e09eda-c2a1-41c9-aa17-c42de0f7e976', 'referee', '2026-06-03 20:58:00+00'),
  ('e7af0584-5356-45a9-b227-2a62f8dcbff2', 'team_demo_delta', 'S. Patel',    'yellow_card', 71, 'second_half', 'e1e09eda-c2a1-41c9-aa17-c42de0f7e976', 'referee', '2026-06-03 21:11:00+00'),
  ('e7af0584-5356-45a9-b227-2a62f8dcbff2', 'team_demo_alpha', 'T. Walsh',    'goal',        88, 'second_half', 'e1e09eda-c2a1-41c9-aa17-c42de0f7e976', 'referee', '2026-06-03 21:28:00+00')
ON CONFLICT DO NOTHING;

-- Fixture 04a6ff0c: Echo Wanderers vs Alpha United, Jun 8 18:00 (Summer League, completed)
INSERT INTO match_events
  (fixture_id, team_id, player_name_override, event_type, minute, period,
   recorded_by_token, recorded_by_type, local_timestamp)
VALUES
  ('04a6ff0c-0ec9-4232-8c93-f31aaf16029d', 'team_demo_echo',  'L. Diallo',   'goal',        9,  'first_half',  '14a8f8a7-8618-4735-8b7b-3a73028ac520', 'referee', '2026-06-08 18:09:00+00'),
  ('04a6ff0c-0ec9-4232-8c93-f31aaf16029d', 'team_demo_alpha', 'J. Okonkwo',  'goal',        43, 'first_half',  '14a8f8a7-8618-4735-8b7b-3a73028ac520', 'referee', '2026-06-08 18:43:00+00'),
  ('04a6ff0c-0ec9-4232-8c93-f31aaf16029d', 'team_demo_echo',  'M. Adebayo',  'goal',        67, 'second_half', '14a8f8a7-8618-4735-8b7b-3a73028ac520', 'referee', '2026-06-08 19:22:00+00'),
  ('04a6ff0c-0ec9-4232-8c93-f31aaf16029d', 'team_demo_alpha', 'B. Clarke',   'yellow_card', 80, 'second_half', '14a8f8a7-8618-4735-8b7b-3a73028ac520', 'referee', '2026-06-08 19:35:00+00')
ON CONFLICT DO NOTHING;

-- Fixture dc000000-f3: Competitive FC vs Demo City, May 21 20:00 (Competitive, completed)
INSERT INTO match_events
  (fixture_id, team_id, player_name_override, event_type, minute, period,
   recorded_by_token, recorded_by_type, local_timestamp)
VALUES
  ('dc000000-0000-4000-8000-0000000000f3', 'team_dc_fc',   'A. Thompson',  'goal',        18, 'first_half',  'c64f4edb-a300-4bc7-ab96-cb574750e787', 'referee', '2026-05-21 20:18:00+00'),
  ('dc000000-0000-4000-8000-0000000000f3', 'team_dc_city', 'K. Bergman',   'goal',        29, 'first_half',  'c64f4edb-a300-4bc7-ab96-cb574750e787', 'referee', '2026-05-21 20:29:00+00'),
  ('dc000000-0000-4000-8000-0000000000f3', 'team_dc_fc',   'A. Thompson',  'goal',        55, 'second_half', 'c64f4edb-a300-4bc7-ab96-cb574750e787', 'referee', '2026-05-21 21:10:00+00'),
  ('dc000000-0000-4000-8000-0000000000f3', 'team_dc_city', 'E. Nkosi',     'yellow_card', 74, 'second_half', 'c64f4edb-a300-4bc7-ab96-cb574750e787', 'referee', '2026-05-21 21:29:00+00')
ON CONFLICT DO NOTHING;

-- Fixture dc000000-f4: Demo Rovers vs Demo Athletic, May 21 20:00 (Competitive, completed)
INSERT INTO match_events
  (fixture_id, team_id, player_name_override, event_type, minute, period,
   recorded_by_token, recorded_by_type, local_timestamp)
VALUES
  ('dc000000-0000-4000-8000-0000000000f4', 'team_dc_rovers',   'F. Owusu',    'goal',        7,  'first_half',  'd17fd9ed-dfb8-41eb-869d-ac88f45bb19d', 'referee', '2026-05-21 20:07:00+00'),
  ('dc000000-0000-4000-8000-0000000000f4', 'team_dc_athletic', 'C. Johansson','goal',        23, 'first_half',  'd17fd9ed-dfb8-41eb-869d-ac88f45bb19d', 'referee', '2026-05-21 20:23:00+00'),
  ('dc000000-0000-4000-8000-0000000000f4', 'team_dc_rovers',   'F. Owusu',    'goal',        62, 'second_half', 'd17fd9ed-dfb8-41eb-869d-ac88f45bb19d', 'referee', '2026-05-21 21:17:00+00'),
  ('dc000000-0000-4000-8000-0000000000f4', 'team_dc_rovers',   'P. Mwangi',   'goal',        79, 'second_half', 'd17fd9ed-dfb8-41eb-869d-ac88f45bb19d', 'referee', '2026-05-21 21:34:00+00'),
  ('dc000000-0000-4000-8000-0000000000f4', 'team_dc_athletic', 'C. Johansson','yellow_card', 83, 'second_half', 'd17fd9ed-dfb8-41eb-869d-ac88f45bb19d', 'referee', '2026-05-21 21:38:00+00')
ON CONFLICT DO NOTHING;

-- ─── 4. Pin a featured fixture on the reception display ───────────────────────
-- Sets featured_fixture_id to the Demo Athletic vs Competitive FC in_progress
-- fixture so the live_scores zone has something to anchor on.
UPDATE venues
SET    display_config = display_config
       || jsonb_build_object(
            'featured_fixture_id', '92e4be46-04e5-4635-96aa-43d98e9a3b5c'
          )
WHERE  id = 'demo_venue';

-- ─── Verification ─────────────────────────────────────────────────────────────
-- [A] In-progress fixtures now on today (expected: 3)
SELECT id, scheduled_date, status FROM fixtures
WHERE  status = 'in_progress'
  AND  scheduled_date = current_date
  AND  competition_id IN (
         SELECT c.id FROM competitions c
         JOIN seasons s ON s.id = c.season_id
         JOIN leagues l ON l.id = s.league_id
         WHERE l.id LIKE '%demo%'
       );

-- [B] Match events seeded (expected: 18 rows across 4 fixtures)
SELECT fixture_id, count(*) AS events FROM match_events
WHERE  fixture_id IN (
  'e7af0584-5356-45a9-b227-2a62f8dcbff2',
  '04a6ff0c-0ec9-4232-8c93-f31aaf16029d',
  'dc000000-0000-4000-8000-0000000000f3',
  'dc000000-0000-4000-8000-0000000000f4'
)
GROUP BY fixture_id;

-- [C] Featured fixture set on display config
SELECT display_config->>'featured_fixture_id' AS featured FROM venues WHERE id = 'demo_venue';
