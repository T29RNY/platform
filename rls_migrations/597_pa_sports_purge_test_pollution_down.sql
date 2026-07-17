-- 597_pa_sports_purge_test_pollution_down.sql
--
-- Reverses 597 by re-creating the test fixtures it purged (Hard Rule 11 — every
-- migration lands with a paired down).
--
-- ⚠️ READ THIS BEFORE RUNNING IT. 597 deleted TEST POLLUTION that was visible to the
-- client on their live public page. Running this down PUTS THE FAKE "U8 Lions" TEAM,
-- ITS TWO FAKE CHILDREN AND THE FAKE "U8 Membership (Free)" TIER BACK ON /c/pa-sports
-- AND BACK ON THE PUBLIC SIGNUP PAGE. There is no product reason to want that. This
-- exists for rule compliance and for emergency restore if 597 is found to have taken
-- something it shouldn't have.
--
-- Restores structure + identity (same ids, so a re-run of 597 removes it again cleanly).
-- It does NOT restore the 15 junk sessions, the 2 junk series or the 2 RSVPs — those
-- were unambiguous test noise ("Test1", "Test Clash", cancelled series) with no
-- reconstructive value. If the intent is to undo 597 wholesale rather than to recover
-- a specific row, prefer restoring from a point-in-time backup instead.
--
-- Depends on the Alex Demo guardian profile (0d000000-0000-4000-8000-000000000011)
-- still existing — 597 deliberately never touched it.

BEGIN;

-- 1. Cohort.
INSERT INTO club_cohorts (id, club_id, name, kind)
VALUES ('c8000000-0000-4000-8000-000000000001', 'club_pa_sports', 'Under 8s', 'youth')
ON CONFLICT (id) DO NOTHING;

-- 2. Team.
INSERT INTO club_teams (id, club_id, cohort_id, name)
VALUES (
  '502e910d-4d88-4003-8320-a93c96b672d5',
  'club_pa_sports',
  'c8000000-0000-4000-8000-000000000001',
  'U8 Lions'
)
ON CONFLICT (id) DO NOTHING;

-- 3. The two fake children.
INSERT INTO member_profiles (id, club_id, first_name, last_name)
VALUES
  ('9d59ec44-a6ef-438c-8871-017ac3212790', 'club_pa_sports', 'Leo',  'Lion'),
  ('4335f988-e73a-45b5-80cb-226cce32a0dd', 'club_pa_sports', 'Lena', 'Lion')
ON CONFLICT (id) DO NOTHING;

-- 4. Guardian links back to the (untouched) Alex Demo profile.
INSERT INTO member_guardians (child_profile_id, guardian_profile_id, relationship, invite_state)
VALUES
  ('9d59ec44-a6ef-438c-8871-017ac3212790', '0d000000-0000-4000-8000-000000000011', 'parent', 'accepted'),
  ('4335f988-e73a-45b5-80cb-226cce32a0dd', '0d000000-0000-4000-8000-000000000011', 'parent', 'accepted')
ON CONFLICT DO NOTHING;

-- 5. Roster.
INSERT INTO club_team_members (team_id, member_profile_id)
VALUES
  ('502e910d-4d88-4003-8320-a93c96b672d5', '9d59ec44-a6ef-438c-8871-017ac3212790'),
  ('502e910d-4d88-4003-8320-a93c96b672d5', '4335f988-e73a-45b5-80cb-226cce32a0dd')
ON CONFLICT DO NOTHING;

-- 6. The free tier + its price.
INSERT INTO venue_membership_tiers (id, venue_id, name, active, audience, benefits)
VALUES (
  '5bb2671f-f606-406c-bd02-bd2a12b65ebc',
  'pa_peugeot',
  'U8 Membership (Free)',
  true,
  'junior',
  '{"is_free": true, "description": "Free U8 membership (demo)", "self_signup": true}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO venue_tier_prices (tier_id, period, price_type, price_pence)
VALUES ('5bb2671f-f606-406c-bd02-bd2a12b65ebc', 'annual', 'standard', 0)
ON CONFLICT DO NOTHING;

-- 7. The invite link.
INSERT INTO invite_links (code, entity_type, entity_id, action, active, created_by)
VALUES (
  'q_pau8demo',
  'club_team',
  '502e910d-4d88-4003-8320-a93c96b672d5',
  'join_club_team',
  true,
  'claude_demo_setup'
)
ON CONFLICT (code) DO NOTHING;

COMMIT;
