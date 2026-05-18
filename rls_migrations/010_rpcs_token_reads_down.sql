-- ============================================================
-- Rollback 010: remove token-based read RPCs and supporting index
-- WARNING: After rollback, /p/<token>, /admin/<token>, and /join/<code>
-- will all fail with permission errors if migrations 006–009 are still applied.
-- Only run as part of a coordinated full RLS rollback.
-- ============================================================

-- Drop index before functions (no FK dependency; conventional order)
DROP INDEX IF EXISTS players_by_token;

-- Drop functions in reverse creation order
DROP FUNCTION IF EXISTS get_team_state_by_admin_token(text);
DROP FUNCTION IF EXISTS get_team_state_by_player_token(text);
DROP FUNCTION IF EXISTS get_team_by_join_code(text);
DROP FUNCTION IF EXISTS get_team_by_admin_token(text);
DROP FUNCTION IF EXISTS get_player_by_token(text);