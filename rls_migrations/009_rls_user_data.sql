-- ============================================================
-- Migration 009: RLS — user-linked tables (user_profiles, player_career,
--                demo_sessions)
-- Phase B: design-only; run in Phase C after 001–008 are applied
-- Depends on: 001 (helpers — shares_team_with_user, shares_team_with_player,
--             is_my_player_id), 006 (players RLS)
-- ============================================================

-- ── user_profiles ────────────────────────────────────────────────────────────
-- Each row is owned by a single auth.users record (user_id = auth.uid()).
-- A player can see their own profile, and can also see profiles of players
-- who share any team with them (so display_name resolves on the roster view).
-- Mutations are self-only; no client-side DELETE (SECURITY DEFINER RPC only).

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON user_profiles FROM anon;
REVOKE ALL ON user_profiles FROM authenticated;

-- SELECT: self, or any authenticated user who shares a team with the profile owner
CREATE POLICY "self_or_shared_team_select_user_profiles"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR shares_team_with_user(user_id)
  );

-- INSERT: can only insert your own profile row
CREATE POLICY "self_insert_user_profiles"
  ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE: can only update your own profile row
CREATE POLICY "self_update_user_profiles"
  ON user_profiles
  FOR UPDATE
  TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No UPDATE/DELETE granted; mutations outside of SELECT/INSERT/UPDATE require
-- a SECURITY DEFINER RPC.
GRANT SELECT, INSERT, UPDATE ON user_profiles TO authenticated;

-- ── player_career ────────────────────────────────────────────────────────────
-- Aggregate stats per player, populated by server-side triggers or RPCs.
-- Clients read only; no client INSERT/UPDATE/DELETE.
-- A player can read their own career row, and teammates can read each other's
-- (career stats are non-sensitive, needed for leaderboard / My IO screens).

ALTER TABLE player_career ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON player_career FROM anon;
REVOKE ALL ON player_career FROM authenticated;

-- SELECT: own career row, or career row for any player on a shared team
CREATE POLICY "self_or_shared_team_select_player_career"
  ON player_career
  FOR SELECT
  TO authenticated
  USING (
    is_my_player_id(player_id)
    OR shares_team_with_player(player_id)
  );

GRANT SELECT ON player_career TO authenticated;

-- ── demo_sessions ────────────────────────────────────────────────────────────
-- Server-managed ephemeral rows; no client role should read or write.
-- Access exclusively via SECURITY DEFINER demo RPC (migration 018).

ALTER TABLE demo_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON demo_sessions FROM anon;
REVOKE ALL ON demo_sessions FROM authenticated;

-- No policies — zero client access by design.

-- ── Deployment order note ────────────────────────────────────────────────────
-- Run AFTER: 001 (helpers must exist), 006 (players RLS, needed by
--            shares_team_with_player / is_my_player_id), 008
-- Run BEFORE: 010+ (RPC migrations assume all tables are locked)
-- After 001–009 applied, all 17 public schema tables are RLS-locked.

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1. RLS enabled on all three tables:
--    SELECT tablename, rowsecurity
--    FROM   pg_tables
--    WHERE  schemaname = 'public'
--    AND    tablename  IN ('user_profiles','player_career','demo_sessions');
--    → rowsecurity = true for all three

-- 2. Correct policy count:
--    SELECT tablename, policyname, cmd
--    FROM   pg_policies
--    WHERE  schemaname = 'public'
--    AND    tablename  IN ('user_profiles','player_career','demo_sessions');
--    → 3 rows on user_profiles (SELECT, INSERT, UPDATE)
--    → 1 row on player_career  (SELECT)
--    → 0 rows on demo_sessions

-- 3. Grants:
--    SELECT grantee, table_name, privilege_type
--    FROM   information_schema.role_table_grants
--    WHERE  table_schema = 'public'
--    AND    table_name   IN ('user_profiles','player_career','demo_sessions')
--    AND    grantee      IN ('anon','authenticated')
--    ORDER BY table_name, grantee, privilege_type;
--    → user_profiles  | authenticated | INSERT
--    → user_profiles  | authenticated | SELECT
--    → user_profiles  | authenticated | UPDATE
--    → player_career  | authenticated | SELECT
--    → (no rows for demo_sessions or anon)

-- 4. Smoke test — user_profiles self-access:
--    -- As authenticated user A:
--    SELECT * FROM user_profiles WHERE user_id = auth.uid(); → own row
--    INSERT INTO user_profiles (user_id, display_name) VALUES (auth.uid(), 'Test'); → OK
--    UPDATE user_profiles SET display_name = 'Test2' WHERE user_id = auth.uid(); → OK
--    -- As authenticated user A, read user B's profile:
--    SELECT * FROM user_profiles WHERE user_id = '<user_b_uuid>';
--    → row returned only if A and B share a team; empty otherwise

-- 5. demo_sessions total block:
--    SET LOCAL role = authenticated;
--    SELECT * FROM demo_sessions LIMIT 1;
--    → ERROR: permission denied for table demo_sessions

-- 6. Full-lockdown audit — after 009 applied, zero accessible tables remain
--    open to anon:
--    SELECT tablename FROM pg_tables
--    WHERE  schemaname = 'public'
--    AND    rowsecurity = false;
--    → 0 rows  (all 17 tables RLS-locked)

-- ── Open issues ──────────────────────────────────────────────────────────────
-- OI-26 (new): player_career schema not confirmed from live supabase.js
--   patterns. Assumption: has columns (player_id text, team_id text?, ...) with
--   player_id as the join key used by shares_team_with_player / is_my_player_id.
--   If player_career uses a different PK or join strategy, adjust the policy
--   USING clause before Phase C apply.
--   Verify: \d player_career in psql.

-- OI-27 (new): demo_sessions schema not confirmed. Assumption: table exists
--   with at least an id column. If demo_sessions does not exist in the live DB
--   yet, skip the ALTER TABLE / REVOKE for that table and add it when the table
--   is created (migration 018 can include CREATE TABLE + immediate RLS enable).

-- OI-28 (new): user_profiles.user_id FK — policy assumes user_profiles.user_id
--   is a uuid referencing auth.users(id). Verify the actual column type:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='user_profiles' AND column_name='user_id';
--   If it's text (not uuid), the comparison user_id = auth.uid() will require a
--   cast: user_id = auth.uid()::text.

-- OI-29 (new): shares_team_with_user(user_id) helper (001_helpers.sql) takes a
--   uuid parameter. If user_profiles.user_id is text (see OI-28), the call must
--   be shares_team_with_user(user_id::uuid) here, and the helper signature may
--   need a text overload. Resolve alongside OI-28.