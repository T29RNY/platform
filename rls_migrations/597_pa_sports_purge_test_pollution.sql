-- 597_pa_sports_purge_test_pollution.sql
--
-- P2 of the PA Sports demo readiness work (see PA_SPORTS_DEMO_HANDOFF.md §0).
-- Removes test pollution that leaked into the PA Sports tenant between 12–15 Jul 2026
-- during agent/on-device test walks. All of it is currently VISIBLE TO THE CLIENT —
-- the "U8 Lions" team and its two fake children render on the live public page
-- /c/pa-sports, and the fake "U8 Membership (Free)" tier is the ONLY membership the
-- public signup page offers (get_venue_signup_tiers('q_L8hbfm3fXy4')).
--
-- WHAT THIS REMOVES (verified counts at authoring time, 2026-07-17):
--   2  junk session series  — "Wednesday Advanced T1", "Test Booking" (both on U7 Milan,
--                             created 2026-07-12). MUST go before any reseed or the
--                             reseed regenerates them from the series definition.
--   15 junk sessions        — Test Booking ×3, Test Clash, Test1, Test2,
--                             Advanced U7 Training T2, Wednesday Advanced T1 ×7 (cancelled)
--   2  RSVPs                — cascade from those sessions
--   1  team                 — "U8 Lions" (502e910d…), created via invite q_pau8demo
--   2  member_profiles      — Leo Lion, Lena Lion (the fake children on the public page)
--   2  venue_memberships    — their free U8 memberships (0 charges — free tier)
--   1  tier + 1 tier price  — "U8 Membership (Free)"
--   1  invite_link          — q_pau8demo (created_by: claude_demo_setup)
--   1  cohort               — "Under 8s"
--
-- WHAT THIS MUST NOT TOUCH:
--   * member_profiles 0d000000-0000-4000-8000-000000000011 ("Alex Demo",
--     tarny+demo@lettrack.co.uk) — the guardian of Leo/Lena. This is a DEMO_VENUE SEED
--     profile shared with other tests, NOT PA data. Only the member_guardians LINK
--     cascades away with the children; the guardian profile itself stays.
--   * Anything in the a5* deterministic seed range (the real PA Sports club).
--
-- ORDER IS FORCED BY FK RULES (verified against information_schema):
--   venue_memberships is NO ACTION against member_profiles, venue_membership_tiers AND
--     club_cohorts  -> must be deleted FIRST or nothing else will delete.
--   club_sessions.team_id -> club_teams is NO ACTION -> sessions before the team.
--   club_teams.cohort_id -> club_cohorts is CASCADE -> the cohort goes LAST, once the
--     team is already gone, so the cascade is a harmless no-op. (Deleting the cohort
--     first would silently take the team with it.)
--   club_fixtures.club_team_id is SET NULL -> would orphan rather than delete; verified
--     U8 Lions has 0 fixtures, so nothing to orphan.
--
-- Idempotent: every statement is a targeted DELETE, safe to re-run (0 rows on re-run).

BEGIN;

-- 1. venue_memberships — the NO ACTION blocker for profiles, tier AND cohort.
DELETE FROM venue_memberships
WHERE tier_id = '5bb2671f-f606-406c-bd02-bd2a12b65ebc'
   OR member_profile_id IN (
        '9d59ec44-a6ef-438c-8871-017ac3212790',  -- Leo Lion
        '4335f988-e73a-45b5-80cb-226cce32a0dd'   -- Lena Lion
      );

-- 2. Junk sessions (cascades their RSVPs + attendance). Also sweeps any session
--    attached to the U8 team, so step 6 can't be blocked by NO ACTION.
DELETE FROM club_sessions
WHERE club_id = 'club_pa_sports'
  AND (
        (id::text NOT LIKE 'a5d0%' AND id::text NOT LIKE 'a5d1%')  -- outside the seed range
        OR team_id = '502e910d-4d88-4003-8320-a93c96b672d5'         -- U8 Lions
      );

-- 3. Junk series — before any reseed, or the reseed regenerates them.
DELETE FROM club_session_series
WHERE club_id = 'club_pa_sports'
  AND id::text NOT LIKE 'a5d0%';

-- 4. The fake children. Cascades club_team_members, member_guardians (link only —
--    the Alex Demo guardian profile survives), consents, id docs, rsvps.
DELETE FROM member_profiles
WHERE id IN (
        '9d59ec44-a6ef-438c-8871-017ac3212790',  -- Leo Lion
        '4335f988-e73a-45b5-80cb-226cce32a0dd'   -- Lena Lion
      );

-- 5. The invite link that minted them.
DELETE FROM invite_links WHERE code = 'q_pau8demo';

-- 6. The team.
DELETE FROM club_teams WHERE id = '502e910d-4d88-4003-8320-a93c96b672d5';

-- 7. The fake tier (cascades venue_tier_prices). This is the row that makes the public
--    signup page offer "U8 Membership (Free) (demo)" instead of PA's real memberships.
DELETE FROM venue_membership_tiers WHERE id = '5bb2671f-f606-406c-bd02-bd2a12b65ebc';

-- 8. The cohort — LAST. Its CASCADE to club_teams is a no-op now that the team is gone.
DELETE FROM club_cohorts
WHERE club_id = 'club_pa_sports'
  AND name = 'Under 8s'
  AND id::text NOT LIKE 'a5c0%';

COMMIT;
