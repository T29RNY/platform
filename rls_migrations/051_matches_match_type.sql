-- Migration 051 — matches.match_type column
-- Phase 0B of venue_league_hq_SCOPE.md.
--
-- Adds a sport-agnostic context flag to every match row:
--   - 'casual'      → friendly kickabout / internal-only / no league context
--   - 'competitive' → league/cup fixture played against an external opponent
--
-- Defaults to 'casual' so every existing match (currently 23 rows) is
-- backfilled instantly without rewriting the table (PostgreSQL ≥ 11
-- treats ADD COLUMN ... NOT NULL DEFAULT as metadata-only).
--
-- No UI change in Phase 0 — the Casual/Competitive stats tab selector lives
-- in Phase 5. This migration only lands the column + index so future code
-- can filter on it.
--
-- Multi-sport posture: `match_type` is sport-agnostic — it describes the
-- *context* of the match (casual vs competitive), not the sport itself.
-- Sport identity lives on `league_config.sport` (and Phase 1 `venues.sport`
-- / `companies.sport`).

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'casual';

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_match_type_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_match_type_check
  CHECK (match_type IN ('casual', 'competitive'));

CREATE INDEX IF NOT EXISTS idx_matches_team_type
  ON public.matches (team_id, match_type);
