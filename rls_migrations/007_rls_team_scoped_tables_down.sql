-- Rollback for migration 007.
--
-- !! DANGER !!
-- Rolling back this migration re-opens read access for anon and authenticated
-- to all nine operational tables:
--
--   team_players   — team membership graph (who is on which team)
--   matches        — every game result, scorers, lineup, voting state, payments jsonb
--   schedule       — match settings, reminders config, lineup lock state
--   settings       — team display names
--   bib_history    — all bib assignment records
--   cover_pool     — cover player names and debt amounts
--   player_match   — full participation records, goals, W/L/D, payment per match
--   player_injuries — injury history (health-adjacent)
--   potm_votes     — vote audit trail (currently empty; anonymity broken if populated)
--
-- All of the above become readable by any anon caller after rollback.
-- Do not run in production without explicit security override approval.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "team_members_select_team_players"    ON team_players;
DROP POLICY IF EXISTS "team_members_select_matches"         ON matches;
DROP POLICY IF EXISTS "team_members_select_schedule"        ON schedule;
DROP POLICY IF EXISTS "team_members_select_settings"        ON settings;
DROP POLICY IF EXISTS "team_members_select_bib_history"     ON bib_history;
DROP POLICY IF EXISTS "team_members_select_cover_pool"      ON cover_pool;
DROP POLICY IF EXISTS "team_members_select_player_match"    ON player_match;
DROP POLICY IF EXISTS "team_members_select_player_injuries" ON player_injuries;
-- potm_votes had no policies; nothing to drop.

ALTER TABLE team_players     DISABLE ROW LEVEL SECURITY;
ALTER TABLE matches           DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule          DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings          DISABLE ROW LEVEL SECURITY;
ALTER TABLE bib_history       DISABLE ROW LEVEL SECURITY;
ALTER TABLE cover_pool        DISABLE ROW LEVEL SECURITY;
ALTER TABLE player_match      DISABLE ROW LEVEL SECURITY;
ALTER TABLE player_injuries   DISABLE ROW LEVEL SECURITY;
ALTER TABLE potm_votes        DISABLE ROW LEVEL SECURITY;

-- Restore pre-migration grant state (full access, matching audit-time state).
GRANT ALL ON team_players     TO anon, authenticated;
GRANT ALL ON matches          TO anon, authenticated;
GRANT ALL ON schedule         TO anon, authenticated;
GRANT ALL ON settings         TO anon, authenticated;
GRANT ALL ON bib_history      TO anon, authenticated;
GRANT ALL ON cover_pool       TO anon, authenticated;
GRANT ALL ON player_match     TO anon, authenticated;
GRANT ALL ON player_injuries  TO anon, authenticated;
GRANT ALL ON potm_votes       TO anon, authenticated;