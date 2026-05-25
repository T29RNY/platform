-- Migration 056 — Phase 1: ALTERs on existing tables (the careful bit)
-- Spec: venue_league_hq_SCOPE.md lines 579–608
--
-- 13 new columns across 4 existing tables. All ADDITIVE:
--   - Every column is NULL-allowing OR has a DEFAULT
--   - No existing data touched
--   - No CHECK constraint applied to existing rows that would fail
--   - PostgreSQL ≥11 treats ADD COLUMN ... DEFAULT as metadata-only
--     (no table rewrite) even on the populated tables
--
-- Three already-done columns from Phase 0 are SKIPPED:
--   - teams.team_type              (migration 052, Phase 0C)
--   - matches.match_type           (migration 051, Phase 0B)
--   - player_match.match_type      (migration 053, Phase 0D)
--
-- FK targets used here all exist as of migration 055:
--   - teams.club_id → clubs(id)
--   - matches.fixture_id → fixtures(id)
--
-- Pre-snapshot row counts (will be unchanged post-migration):
--   teams=3, matches=23, players=41, player_match=266
--
-- Multi-sport posture applied:
--   - notification_channel CHECK list is sport-neutral
--   - No new column contains 'goal','motm','card','bib','cleanSheet' in its name
--   - shirt_number / minutes_played / was_substitute are generic
--     enough for football, cricket, basketball, hockey, netball

-- ─── teams ───────────────────────────────────────────────────────────────

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS club_id          text NULL REFERENCES public.clubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_colour   text NULL,
  ADD COLUMN IF NOT EXISTS secondary_colour text NULL;

CREATE INDEX IF NOT EXISTS teams_club_id_idx ON public.teams (club_id) WHERE club_id IS NOT NULL;

-- ─── matches ─────────────────────────────────────────────────────────────

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS fixture_id       uuid NULL REFERENCES public.fixtures(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opponent_team_id text NULL,
  ADD COLUMN IF NOT EXISTS opponent_name    text NULL;

CREATE INDEX IF NOT EXISTS matches_fixture_id_idx ON public.matches (fixture_id) WHERE fixture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS matches_opponent_team_id_idx ON public.matches (opponent_team_id) WHERE opponent_team_id IS NOT NULL;

-- ─── players ─────────────────────────────────────────────────────────────

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS shirt_number          integer NULL,
  ADD COLUMN IF NOT EXISTS date_of_birth         date NULL,
  ADD COLUMN IF NOT EXISTS phone                 text NULL,
  ADD COLUMN IF NOT EXISTS notification_channel  text NOT NULL DEFAULT 'push';

-- CHECK as a separate statement so the NOT NULL DEFAULT applies cleanly first
ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_notification_channel_check;

ALTER TABLE public.players
  ADD CONSTRAINT players_notification_channel_check
  CHECK (notification_channel IN ('push','whatsapp','sms','email'));

-- ─── player_match ────────────────────────────────────────────────────────

ALTER TABLE public.player_match
  ADD COLUMN IF NOT EXISTS minutes_played integer NULL,
  ADD COLUMN IF NOT EXISTS was_substitute boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shirt_number   integer NULL;
