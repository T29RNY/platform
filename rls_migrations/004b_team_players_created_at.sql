-- Migration 004b: Add team_players.created_at
--
-- Purpose: supplies the ordering column required for deterministic "first joined team"
-- semantics in get_team_state_by_player_token (Correction 5, Phase B Prompt 2).
-- Without this column, multi-team player resolution is non-deterministic.
--
-- PostgreSQL behaviour for ADD COLUMN ... DEFAULT now():
--   now() is classified as STABLE (returns the same value for the duration of a
--   transaction). PostgreSQL 11+ stores a STABLE or IMMUTABLE default via
--   pg_attribute.attmissingval — a single value written at ALTER time and returned
--   lazily for all pre-existing rows. This means every row that existed before this
--   migration appears to have the same created_at timestamp (the ALTER moment).
--   Rows inserted after this migration each receive a fresh now() evaluation.
--
--   Stage 1 impact: acceptable. No real multi-team players exist at migration time.
--   Pre-migration rows cannot be meaningfully ordered relative to each other, but
--   get_team_state_by_player_token returns the single team every current player is on,
--   so the ordering is irrelevant until a player appears in two teams.

ALTER TABLE team_players
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Supports: SELECT team_id FROM team_players
--           WHERE player_id = $1 ORDER BY created_at ASC LIMIT 1
CREATE INDEX IF NOT EXISTS team_players_by_player_created
  ON team_players (player_id, created_at ASC);