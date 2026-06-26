-- 440_referee_demo_seed.sql
-- Demo seed for the REFEREE role in the unified /hub mobile app.
--
-- No demo user had any officiating link, so the new "My fixtures" (RefFixtures)
-- screen + the referee hat in the context switcher had no data to render. This
-- gives the tarny+demo user (person c029db7a-9bc0-4d54-b5fe-94efccb14395 — already
-- an operator, so /hub already mounts) a match-official identity at demo_venue and
-- assigns three internal-league fixtures to it: one LIVE (in_progress) + two
-- upcoming. get_my_assignments / get_my_world.ref_assignments then return games.
--
-- Additive + idempotent (ON CONFLICT DO NOTHING). Reuses the existing demo 3v3
-- league (competition 3a3a0000-…-010), its teams and pitch — no new entities.
-- NOT ephemeral-verify: this is a deliberate, permanent demo seed (mirrors mig 427).

-- 1. The official card, linked to the demo user's person.
INSERT INTO public.match_officials
  (id, venue_id, name, preferred_channel, employment_type, active, person_id)
VALUES
  ('70000000-0000-4000-8000-000000000640', 'demo_venue', 'Demo Referee',
   'email', 'in_house', true, 'c029db7a-9bc0-4d54-b5fe-94efccb14395')
ON CONFLICT (id) DO NOTHING;

-- 2. Three fixtures assigned to that official (deterministic ids, demo ref_tokens).
--    Reuses competition 3a3a…010 (3v3 league) and its teams. playing_area_id is
--    left NULL on purpose: (a) it isn't needed — get_my_assignments derives the
--    venue from the official's venue_id, and the ref-app reader derives it via the
--    league chain; (b) a NULL playing area skips the pitch-occupancy clash trigger
--    (mig 412/424), so the seed never collides with an existing booking on a pitch.
INSERT INTO public.fixtures
  (id, competition_id, home_team_id, away_team_id, week_number, scheduled_date,
   kickoff_time, playing_area_id, official_id, ref_token, status,
   actual_kickoff_at)
VALUES
  -- LIVE now → RefFixtures "Live now" group + ref-app LiveMatch view in the iframe.
  ('70000000-0000-4000-8000-000000000641', '3a3a0000-0000-4000-8000-000000000010',
   'team_3v3_jag', 'team_3v3_haw', 9, (now() AT TIME ZONE 'Europe/London')::date,
   '19:00:00', NULL,
   '70000000-0000-4000-8000-000000000640', 'ref_demo_referee_live', 'in_progress',
   now() - interval '15 minutes'),
  -- Upcoming (tomorrow) → ref-app PreMatch view.
  ('70000000-0000-4000-8000-000000000642', '3a3a0000-0000-4000-8000-000000000010',
   'team_3v3_pum', 'team_3v3_cob', 10, ((now() AT TIME ZONE 'Europe/London')::date + 1),
   '19:00:00', NULL,
   '70000000-0000-4000-8000-000000000640', 'ref_demo_referee_up1', 'scheduled', NULL),
  -- Upcoming (in two days).
  ('70000000-0000-4000-8000-000000000643', '3a3a0000-0000-4000-8000-000000000010',
   'team_3v3_bol', 'team_3v3_sha', 11, ((now() AT TIME ZONE 'Europe/London')::date + 2),
   '11:00:00', NULL,
   '70000000-0000-4000-8000-000000000640', 'ref_demo_referee_up2', 'scheduled', NULL)
ON CONFLICT (id) DO NOTHING;
