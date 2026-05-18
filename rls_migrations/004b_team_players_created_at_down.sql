-- Rollback for migration 004b.
--
-- After rollback, get_team_state_by_player_token loses deterministic team
-- resolution for multi-team players. This is safe only if no multi-team
-- players exist at rollback time.

DROP INDEX IF EXISTS team_players_by_player_created;

ALTER TABLE team_players
  DROP COLUMN IF EXISTS created_at;