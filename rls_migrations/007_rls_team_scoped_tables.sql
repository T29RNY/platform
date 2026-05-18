-- ─────────────────────────────────────────────────────────────────────────────
-- DEPLOYMENT ORDER REQUIREMENT
-- ─────────────────────────────────────────────────────────────────────────────
-- The following migrations MUST be applied before this migration:
--
--   001_helpers.sql               — is_team_member helper used in all policies
--   002_team_admins.sql           — referenced by is_team_member
--   003_audit_events.sql          — no direct dependency
--   004_teams_live_channel_key.sql — no direct dependency
--   004b_team_players_created_at.sql — required for get_team_state_by_player_token
--   005_views.sql                 — matches_public view is the SELECT path for matches
--   006_rls_bearer_token_tables.sql — bearer-token tables locked; verify before
--                                     extending the RLS lockdown to operational tables
--
-- The RPC migrations (010, 011, 012, 013, 016) provide the alternative read/write
-- paths for any client code that currently does direct table queries against these
-- nine tables. Confirm RPCs are deployed and the client is refactored before this
-- migration locks the tables in production.
--
-- This migration touches 9 tables in a single file. If any statement fails
-- (e.g. a table does not exist on the target database), the entire migration
-- should be rolled back. When applying manually with psql, wrap in a transaction:
--   BEGIN;
--   \i 007_rls_team_scoped_tables.sql
--   COMMIT;
-- Supabase's managed migration runner wraps each file in a transaction by default.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Schema pre-flight (all nine tables confirmed against live schema 2026-05-18):
--   team_players    — has team_id ✓
--   matches         — has team_id ✓
--   schedule        — has team_id ✓
--   settings        — has team_id ✓
--   bib_history     — has team_id ✓
--   cover_pool      — has team_id ✓
--   player_match    — has team_id ✓ (indexes idx_player_match_team_attended,
--                     idx_player_match_team_player added in Session 21)
--   player_injuries — has team_id ✓
--   potm_votes      — has team_id ✓
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.1: team_players
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE team_players ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see team membership rows for teams they belong to.
-- This covers both player and admin membership (is_team_member checks both paths).
CREATE POLICY "team_members_select_team_players"
  ON team_players
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- INSERT/UPDATE/DELETE: SECURITY DEFINER RPCs only.
--   create_team (015): initial team_players rows for seeded players
--   admin_add_player (012): new player linked to team
--   join_team_as_new_player (015): authenticated player joins team
--   admin_delete_player (012): removes team_players row (after §9 guard passes)

REVOKE ALL ON team_players FROM anon;
REVOKE ALL ON team_players FROM authenticated;
GRANT SELECT ON team_players TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.2: matches
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see matches for teams they belong to.
-- NOTE: authenticated does NOT receive GRANT SELECT on the matches table directly.
-- The read path for matches is exclusively through the matches_public view
-- (migration 005), which masks teams_draft and payments. The view uses
-- security_invoker = false, so the view owner (postgres) accesses the table
-- and this RLS policy is evaluated against the calling user's identity.
-- Without this policy, the view would return ALL matches to any authenticated
-- user regardless of team membership.
CREATE POLICY "team_members_select_matches"
  ON matches
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- INSERT/UPDATE/DELETE: SECURITY DEFINER RPCs only.
--   admin_save_match_result (013), admin_save_teams (013),
--   admin_save_bib_holder (013), admin_cancel_match (013)

REVOKE ALL ON matches FROM anon;
REVOKE ALL ON matches FROM authenticated;
-- No GRANT SELECT on matches directly.
-- authenticated uses the matches_public view (GRANT SELECT applied in migration 005).
-- anon accesses match data via SECURITY DEFINER RPCs (migration 010).


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.3: schedule
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see schedule rows for teams they belong to.
-- schedule contains: kickoff, venue, squad_size, price_per_player, bibs_enabled,
-- opens_day, opens_time, priority_lead_mins, reminders_config, game_is_live,
-- lineup_locked, active_match_id, is_cancelled, voting_open, voting_closes_at, etc.
-- All of this is visible to authenticated team members (no column-level masking
-- required for schedule — no sensitive-only columns present).
CREATE POLICY "team_members_select_schedule"
  ON schedule
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- INSERT/UPDATE/DELETE: SECURITY DEFINER RPCs only.
--   create_team (015): initial schedule row
--   admin_upsert_schedule (013): schedule settings update
--   admin_cancel_match (013): updates is_cancelled, game_is_live, cancel_reason
--   Cron jobs (service role): lineup_locked, game_is_live, voting_open,
--     active_match_id, auto_open_pending — all bypass RLS via service role

REVOKE ALL ON schedule FROM anon;
REVOKE ALL ON schedule FROM authenticated;
GRANT SELECT ON schedule TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.4: settings
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see settings for teams they belong to.
-- settings currently contains only: id, team_id, group_name.
-- No sensitive columns — standard team-scoped read access.
CREATE POLICY "team_members_select_settings"
  ON settings
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- INSERT/UPDATE/DELETE: SECURITY DEFINER RPCs only.
--   create_team (015): initial settings row
--   admin_upsert_settings (013): group_name update

REVOKE ALL ON settings FROM anon;
REVOKE ALL ON settings FROM authenticated;
GRANT SELECT ON settings TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.5: bib_history
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE bib_history ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see bib_history for teams they belong to.
-- bib_history contains: team_id, player_id (nullable), name (text), match_date,
-- returned (boolean).
-- Unique constraint: (team_id, match_date) — one bib holder per team per matchday.
-- Note: keyed on match_date (not match_id). admin_save_bib_holder must look up
-- match_date from matches given the p_match_id parameter. See OI-20.
CREATE POLICY "team_members_select_bib_history"
  ON bib_history
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- INSERT/UPDATE/DELETE: SECURITY DEFINER RPCs only.
--   admin_save_bib_holder (013): UPSERT on (team_id, match_date) conflict key

REVOKE ALL ON bib_history FROM anon;
REVOKE ALL ON bib_history FROM authenticated;
GRANT SELECT ON bib_history TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.6: cover_pool
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE cover_pool ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see cover pool entries for teams they belong to.
-- cover_pool contains: id, team_id, name, played, owes.
-- Cover players are not authenticated users — they are name-only records
-- managed by the admin. The team_id column scopes them correctly.
CREATE POLICY "team_members_select_cover_pool"
  ON cover_pool
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- INSERT/UPDATE/DELETE: SECURITY DEFINER RPCs only.
--   admin_add_cover_player (012)
--   admin_remove_cover_player (012)
--   admin_update_cover_player (012)

REVOKE ALL ON cover_pool FROM anon;
REVOKE ALL ON cover_pool FROM authenticated;
GRANT SELECT ON cover_pool TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.7: player_match
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE player_match ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see player_match rows for teams they belong to.
--
-- player_match is the heaviest-read table in the database. It drives:
--   - IO Intelligence stats (MyIOView)
--   - Player League Table (PlayerLeagueTable)
--   - StatsView form and head-to-head calculations
--   - admin_save_match_result career stat recompute
--
-- Columns confirmed: team_id, match_id, player_id, team_assignment (A/B side),
--   result (W/L/D), attended (boolean), late_cancel, injury_absence, was_motm,
--   had_bibs, goals, is_guest, paid, paid_at, amount.
--
-- Performance: two indexes added in Session 21 cover the RLS access pattern:
--   idx_player_match_team_attended (team_id, attended)
--   idx_player_match_team_player   (team_id, player_id)
-- The is_team_member(team_id) predicate benefits from these indexes because
-- PostgreSQL can intersect the team_id filter from the RLS clause with the
-- team_id from these indexes. Verify with EXPLAIN ANALYZE in Phase D.
CREATE POLICY "team_members_select_player_match"
  ON player_match
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- INSERT/UPDATE/DELETE: SECURITY DEFINER RPCs only.
--   admin_save_match_result (013): UPSERT player_match rows per attendee
--   admin_cancel_match (013): DELETE all player_match rows for the match
--   Cron lineup lock job: inserts locked rows via service role

REVOKE ALL ON player_match FROM anon;
REVOKE ALL ON player_match FROM authenticated;
GRANT SELECT ON player_match TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.8: player_injuries
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE player_injuries ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users see injury records for players on their teams.
-- player_injuries contains: id, player_id, team_id, injured_at, cleared_at,
-- marked_by (text — name of who marked the injury).
-- Health-adjacent data, but currently shared with all team members in the
-- existing player view (injured status is visible on the squad list).
-- Row access scoped to team membership. No column-level masking applied.
CREATE POLICY "team_members_select_player_injuries"
  ON player_injuries
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id));

-- INSERT/UPDATE/DELETE: SECURITY DEFINER RPCs only.
--   set_player_injured (011): token-holder marks own injury; inserts/updates row
--   (admin injury management RPC if added in Phase 2)

REVOKE ALL ON player_injuries FROM anon;
REVOKE ALL ON player_injuries FROM authenticated;
GRANT SELECT ON player_injuries TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7.9: potm_votes — STRICT ANONYMITY OVERRIDE
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE potm_votes ENABLE ROW LEVEL SECURITY;

-- NO SELECT, INSERT, UPDATE, or DELETE policies for ANY client role.
--
-- potm_votes contains: match_id, team_id, voter_id, nominee_id.
-- Votes must be strictly anonymous: no client role — including authenticated
-- admins — may read individual vote rows directly. Access is exclusively:
--
--   cast_potm_vote (016, SECURITY DEFINER):
--     INSERT for the calling player's vote (token-validated)
--
--   get_my_potm_vote (016, SECURITY DEFINER):
--     SELECT own row only — returns at most one row for (voter_id, match_id)
--
--   get_potm_tally (016, SECURITY DEFINER):
--     Aggregated counts only (GROUP BY nominee_id) — admin-token validated
--     Never exposes voter_id or individual vote rows
--
--   Cron potmTallyJob (service role, bypasses RLS):
--     Reads all votes to determine the winner; writes result to matches.motm
--
-- RLS enabled with no permissive policies = all client-role access denied.
-- The potm_votes table is a write-once store; no UPDATE permitted at any level.

REVOKE ALL ON potm_votes FROM anon;
REVOKE ALL ON potm_votes FROM authenticated;
-- No grants to any client role. All access is through SECURITY DEFINER RPCs
-- or the service role (cron).


-- ─────────────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION QUERIES (manual, not part of migration)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Confirm RLS enabled on all 9 tables.
--    Expected: 9 rows, all with rowsecurity = true.
--
-- SELECT schemaname, tablename, rowsecurity
-- FROM   pg_tables
-- WHERE  schemaname = 'public'
--   AND  tablename IN (
--     'team_players', 'matches', 'schedule', 'settings', 'bib_history',
--     'cover_pool', 'player_match', 'player_injuries', 'potm_votes'
--   )
-- ORDER BY tablename;

-- 2. Confirm correct policy count per table.
--    Expected: 8 tables with 1 SELECT policy each; potm_votes with 0 policies.
--
-- SELECT tablename, count(*) AS policy_count
-- FROM   pg_policies
-- WHERE  schemaname = 'public'
--   AND  tablename IN (
--     'team_players', 'matches', 'schedule', 'settings', 'bib_history',
--     'cover_pool', 'player_match', 'player_injuries', 'potm_votes'
--   )
-- GROUP BY tablename
-- ORDER BY tablename;

-- 3. Confirm anon is blocked from all 9 tables.
--
-- SET ROLE anon;
-- SELECT count(*) FROM team_players;     -- expect 0 or permission denied
-- SELECT count(*) FROM matches;          -- expect 0 or permission denied
-- SELECT count(*) FROM schedule;         -- expect 0 or permission denied
-- SELECT count(*) FROM settings;         -- expect 0 or permission denied
-- SELECT count(*) FROM bib_history;      -- expect 0 or permission denied
-- SELECT count(*) FROM cover_pool;       -- expect 0 or permission denied
-- SELECT count(*) FROM player_match;     -- expect 0 or permission denied
-- SELECT count(*) FROM player_injuries;  -- expect 0 or permission denied
-- SELECT count(*) FROM potm_votes;       -- expect 0 or permission denied
-- RESET ROLE;

-- 4. Confirm authenticated cannot read potm_votes directly (strict anonymity).
--
-- SET ROLE authenticated;
-- SET request.jwt.claims = '{"sub": "<tarny_user_id>", "role": "authenticated"}';
-- SELECT count(*) FROM potm_votes;       -- expect: permission denied
-- RESET ROLE;

-- 5. Confirm authenticated can read matches for their team via matches_public.
--    (Verifies the matches SELECT RLS policy fires correctly through the view.)
--
-- SET ROLE authenticated;
-- SET request.jwt.claims = '{"sub": "<tarny_user_id>", "role": "authenticated"}';
-- SELECT count(*) FROM matches_public;   -- expect: rows for Tarny's teams only
-- SELECT count(*) FROM matches;          -- expect: permission denied (no direct grant)
-- RESET ROLE;

-- 6. Confirm authenticated cannot read matches from a team they are NOT on.
--    Requires a second team in the database with a separate membership set.
--
-- SET ROLE authenticated;
-- SET request.jwt.claims = '{"sub": "<other_user_id>", "role": "authenticated"}';
-- SELECT count(*) FROM matches_public WHERE team_id = 'team_demo'; -- expect 0 if not a member
-- RESET ROLE;

-- 7. Confirm player_match read performance under RLS (Phase D gate).
--    Expected: Index Scan using idx_player_match_team_attended or
--    idx_player_match_team_player. NOT a sequential scan.
--
-- SET ROLE authenticated;
-- SET request.jwt.claims = '{"sub": "<tarny_user_id>", "role": "authenticated"}';
-- EXPLAIN ANALYZE
--   SELECT player_id, result, attended
--   FROM   player_match
--   WHERE  team_id = 'team_demo';
-- RESET ROLE;