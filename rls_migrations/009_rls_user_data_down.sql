-- ============================================================
-- Rollback 009: undo user-data table RLS
-- ============================================================

-- ── demo_sessions ─────────────────────────────────────────────────────────────
ALTER TABLE demo_sessions DISABLE ROW LEVEL SECURITY;

GRANT ALL ON demo_sessions TO anon;
GRANT ALL ON demo_sessions TO authenticated;

-- ── player_career ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "self_or_shared_team_select_player_career" ON player_career;

ALTER TABLE player_career DISABLE ROW LEVEL SECURITY;

GRANT ALL ON player_career TO anon;
GRANT ALL ON player_career TO authenticated;

-- ── user_profiles ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "self_insert_user_profiles"              ON user_profiles;
DROP POLICY IF EXISTS "self_update_user_profiles"              ON user_profiles;
DROP POLICY IF EXISTS "self_or_shared_team_select_user_profiles" ON user_profiles;

ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;

GRANT ALL ON user_profiles TO anon;
GRANT ALL ON user_profiles TO authenticated;