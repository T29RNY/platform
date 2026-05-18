-- Rollback for migration 006.
--
-- !! DANGER !!
-- Running this rollback re-opens the following vulnerabilities:
--   - Any anon caller can enumerate ALL teams, including admin_token and
--     admin_email for every team in the database.
--   - Any anon caller can enumerate ALL players, including token (bearer
--     credential for /p/<token> URLs) and user_id (auth identity).
--   - Any anon caller can enumerate ALL push_subscriptions, including
--     player_token and VAPID endpoint credentials.
--
-- Do NOT run in production without:
--   (a) explicit security override approval
--   (b) immediate rotation of all admin_token and player token values
--   (c) a plan to re-apply the migration within minutes
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the partial index added by this migration (before policy drops for
-- logical ordering — both are safe within a transaction either way).
DROP INDEX IF EXISTS players_by_user_id;

-- Drop policies before disabling RLS.
DROP POLICY IF EXISTS "team_members_select_teams"           ON teams;
DROP POLICY IF EXISTS "own_or_shared_team_select_players"  ON players;
-- push_subscriptions had no policies; nothing to drop.

-- Disable RLS.
ALTER TABLE teams              DISABLE ROW LEVEL SECURITY;
ALTER TABLE players            DISABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY;

-- Restore the pre-migration grant state (full access for both client roles).
-- This matches the state of the live database at audit time (Stage 5b, 2026-05-18):
-- all tables were fully readable and writable by anon and authenticated.
GRANT ALL ON teams              TO anon;
GRANT ALL ON teams              TO authenticated;
GRANT ALL ON players            TO anon;
GRANT ALL ON players            TO authenticated;
GRANT ALL ON push_subscriptions TO anon;
GRANT ALL ON push_subscriptions TO authenticated;