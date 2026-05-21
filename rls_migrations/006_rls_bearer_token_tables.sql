-- ─────────────────────────────────────────────────────────────────────────────
-- DEPLOYMENT ORDER REQUIREMENT
-- ─────────────────────────────────────────────────────────────────────────────
-- The following migrations MUST have been applied before this migration runs:
--
--   001_helpers.sql               — is_team_member, shares_team_with_player
--   002_team_admins.sql           — team_admins table (read by is_team_member)
--   003_audit_events.sql          — no dependency for this migration
--   004_teams_live_channel_key.sql — no dependency for this migration
--   004b_team_players_created_at.sql — no dependency for this migration
--   005_views.sql                 — teams_public, players_public, matches_public
--                                    must exist before table access is revoked;
--                                    otherwise authenticated users have no read
--                                    path at all.
--
-- CRITICAL: The RPC migrations (010, 011) enable the anon read path.
-- Applying THIS migration before migrations 010 and 011 closes all anon access:
--   - /p/<token> — broken (player token RPC not yet deployed)
--   - /admin/<admin_token> — broken (admin token RPC not yet deployed)
--   - /demoadmin — broken
--
-- SAFE DEPLOYMENT SEQUENCE:
--   1. Apply 001–005 (helpers, new tables, views)
--   2. Apply 010–011 (token-based read/write RPCs)
--   3. Refactor client to call RPCs instead of direct queries
--   4. Verify on test team (team_audit per §17)
--   5. Apply THIS migration (006) — table lockdown
--   6. Verify again on test team
--   7. Apply to production
--
-- Do NOT apply this migration to production while active clients are using
-- direct queries against teams, players, or push_subscriptions.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 1: teams
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see only teams they belong to (as player or admin).
-- is_team_member(id) checks:
--   (a) team_players → players.user_id = auth.uid()  (player membership)
--   (b) team_admins.user_id = auth.uid() WHERE revoked_at IS NULL  (admin membership)
-- This policy fires when an authenticated user queries via the teams_public view.
-- The view uses security_invoker = false (view owner = postgres), so the view
-- accesses the table using postgres's privileges. RLS is evaluated for the
-- CALLING USER (authenticated), not the view owner. The net effect:
--   - authenticated sees only their teams through the view
--   - authenticated cannot see admin_token or admin_email (masked by view)
--   - authenticated cannot see live_channel_key (removed from teams_public per OI-15)
CREATE POLICY "team_members_select_teams"
  ON teams
  FOR SELECT
  TO authenticated
  USING (is_team_member(id));

-- INSERT: no policy → denied for all non-service-role callers.
-- UPDATE: no policy → denied for all non-service-role callers.
-- DELETE: no policy → denied permanently.

-- Revoke all direct table privileges from both client roles.
-- authenticated users access teams only through the teams_public view.
-- anon users access team data only through SECURITY DEFINER RPCs.
REVOKE ALL ON teams FROM anon;
REVOKE ALL ON teams FROM authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 2: players
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Index for the RLS policy's self-row fast path (user_id = auth.uid()).
-- Also accelerates player_get_teams and player_join_team returning-user lookup.
-- Partial (WHERE user_id IS NOT NULL): keeps the index small. Token-only players
-- (no auth account linked yet) are excluded; they are never looked up by user_id.
CREATE INDEX IF NOT EXISTS players_by_user_id
  ON players (user_id)
  WHERE user_id IS NOT NULL;

-- SELECT: authenticated users see their own player record (any team) plus
-- all players who share at least one team with them.
--
-- Predicate breakdown:
--   (a) user_id = auth.uid()
--       Self-row fast path: single indexed column compare against the partial
--       index created above. No function call overhead.
--       Handles the case where the authenticated user's player is on a different
--       team than any team they are currently viewing.
--
--   (b) shares_team_with_player(id)
--       Team-sharing check: joins team_players twice to find a common team.
--       Used for every non-self player row during a squad or stats query.
--       Players on teams the caller is NOT a member of are invisible.
CREATE POLICY "own_or_shared_team_select_players"
  ON players
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR
    shares_team_with_player(id)
  );

-- INSERT/UPDATE/DELETE: no policies → denied for all non-service-role callers.

REVOKE ALL ON players FROM anon;
REVOKE ALL ON players FROM authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 3: push_subscriptions
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- No SELECT, INSERT, UPDATE, or DELETE policies for any client role.
--
-- push_subscriptions contains:
--   - player_token (same secret as the /p/<token> bearer URL)
--   - player_id, team_id (identity linkage)
--   - subscription (VAPID endpoint + browser push auth keys)
--
-- These must never be readable by any client. Access is exclusively:
--   (a) SECURITY DEFINER RPCs: register_push_subscription,
--       unregister_push_subscription (migration 011) — writes
--   (b) Service role (cron jobs in notify.js) — reads for sending notifications
--
-- RLS enabled with no permissive policies = all client-role access denied.

REVOKE ALL ON push_subscriptions FROM anon;
REVOKE ALL ON push_subscriptions FROM authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION QUERIES (manual, not part of migration)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Confirm RLS is enabled on all three tables.
--    Expected: 3 rows, all with rowsecurity = true.
--
-- SELECT schemaname, tablename, rowsecurity
-- FROM   pg_tables
-- WHERE  schemaname = 'public'
--   AND  tablename IN ('teams', 'players', 'push_subscriptions')
-- ORDER BY tablename;

-- 2. Confirm correct policies and the new partial index exist.
--    Expected: 1 policy on teams, 1 on players, 0 on push_subscriptions.
--
-- SELECT schemaname, tablename, policyname, cmd, array_to_string(roles, ',') AS roles
-- FROM   pg_policies
-- WHERE  schemaname = 'public'
--   AND  tablename IN ('teams', 'players', 'push_subscriptions')
-- ORDER BY tablename, policyname;
--
-- SELECT indexname, indexdef
-- FROM   pg_indexes
-- WHERE  schemaname = 'public'
--   AND  tablename  = 'players'
--   AND  indexname  = 'players_by_user_id';

-- 3. Confirm anon is blocked from all three tables.
-- SET ROLE anon;
-- SELECT count(*) FROM teams;              -- expect 0 or permission denied
-- SELECT count(*) FROM players;            -- expect 0 or permission denied
-- SELECT count(*) FROM push_subscriptions; -- expect 0 or permission denied
-- RESET ROLE;

-- 4. Confirm authenticated can read their own teams through teams_public.
-- SET ROLE authenticated;
-- SET request.jwt.claims = '{"sub": "<tarny_user_id_uuid>", "role": "authenticated"}';
-- SELECT id, name FROM teams_public;       -- expect only Tarny's teams
-- RESET ROLE;

-- 5. Confirm authenticated cannot read admin_token directly from teams.
-- SET ROLE authenticated;
-- SELECT admin_token FROM teams LIMIT 1;   -- expect: permission denied
-- RESET ROLE;

-- 6. Confirm authenticated cannot read live_channel_key from teams_public.
-- SET ROLE authenticated;
-- SET request.jwt.claims = '{"sub": "<tarny_user_id_uuid>", "role": "authenticated"}';
-- SELECT live_channel_key FROM teams_public LIMIT 1; -- expect: column does not exist
-- RESET ROLE;

-- 7. Confirm authenticated cannot read push_subscriptions.
-- SET ROLE authenticated;
-- SELECT count(*) FROM push_subscriptions; -- expect: permission denied
-- RESET ROLE;