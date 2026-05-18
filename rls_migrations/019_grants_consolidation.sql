-- =============================================================================
-- Migration 019: Grants / revokes consolidation (idempotent safety net)
-- =============================================================================
-- This migration has NO down migration. It is a belt-and-suspenders pass
-- that ensures every table, view, and RPC has exactly the intended grant
-- state after all 001-018 migrations have run.
--
-- Run order: after all other migrations. Safe to re-run.
--
-- Intended access summary:
--   anon role        : token-based + demo RPCs only; no direct table access
--   authenticated    : all RPCs + view SELECTs; no direct table access
--   service_role     : bypasses RLS entirely (Supabase built-in; no grant needed)
--   public           : no grants on anything (Supabase default; explicitly revoked here)
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables — REVOKE ALL from anon and authenticated
-- =============================================================================
-- All 17 base tables + team_admins + audit_events must be inaccessible to
-- anon and authenticated roles. SECURITY DEFINER RPCs (running as table owner)
-- are the sole permitted read/write paths. Service role bypasses RLS.

REVOKE ALL ON TABLE teams             FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE players           FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE team_players      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE matches           FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE schedule          FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE settings          FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE bib_history       FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE cover_pool        FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE player_match      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE player_career     FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE player_injuries   FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE payment_ledger    FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE potm_votes        FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE demo_sessions     FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE push_subscriptions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE notification_log  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE audit_events      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE team_admins       FROM anon, authenticated, PUBLIC;


-- =============================================================================
-- SECTION 2: Views — GRANT SELECT to authenticated only
-- =============================================================================
-- Views use security_invoker = false (owner privileges) so SECURITY DEFINER
-- is not needed — but base table is revoked so direct SELECT still fails for
-- non-owner roles. Views provide column-level masking for authenticated users.
--
-- teams_public   : excludes admin_token, admin_email
-- players_public : excludes token, user_id, paid_at, role_scope
-- matches_public : excludes teams_draft, payments

REVOKE ALL ON TABLE teams_public   FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE players_public FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE matches_public FROM anon, authenticated, PUBLIC;

GRANT SELECT ON TABLE teams_public   TO authenticated;
GRANT SELECT ON TABLE players_public TO authenticated;
GRANT SELECT ON TABLE matches_public TO authenticated;


-- =============================================================================
-- SECTION 3: RPCs — GRANT EXECUTE / REVOKE from PUBLIC
-- =============================================================================
-- Organised by source migration for auditability.
-- Principle: REVOKE from PUBLIC first (belt), then GRANT to specific roles.


-- ── Migration 001: helper predicates ─────────────────────────────────────────
-- Internal use only — called inside SECURITY DEFINER RPCs and RLS policies.
-- No external grant.

REVOKE ALL ON FUNCTION is_team_member(text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION shares_team_with_player(text)    FROM PUBLIC;
REVOKE ALL ON FUNCTION shares_team_with_user(uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION is_my_player_id(text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION generate_url_safe_token(text, int) FROM PUBLIC;


-- ── Migration 010: token-based read RPCs ──────────────────────────────────────
-- Token-based reads: anon + authenticated (no auth required for token callers)

REVOKE ALL ON FUNCTION get_player_by_token(text)               FROM PUBLIC;
REVOKE ALL ON FUNCTION get_team_by_admin_token(text)           FROM PUBLIC;
REVOKE ALL ON FUNCTION get_team_by_join_code(text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION get_team_state_by_player_token(text)    FROM PUBLIC;
REVOKE ALL ON FUNCTION get_team_state_by_admin_token(text)     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_player_by_token(text)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_team_by_admin_token(text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_team_by_join_code(text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_team_state_by_player_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_team_state_by_admin_token(text)  TO anon, authenticated;

-- Authenticated-only reads (require auth.uid())
-- REVOKE ALL ON FUNCTION get_my_player_for_team(text) FROM PUBLIC;
-- REVOKE ALL ON FUNCTION get_my_teams()               FROM PUBLIC;

-- GRANT EXECUTE ON FUNCTION get_my_player_for_team(text) TO authenticated;
-- GRANT EXECUTE ON FUNCTION get_my_teams()               TO authenticated;


-- ── Migration 011: player write RPCs + broadcast helper ────────────────────────
-- Player writes: token-based → anon + authenticated

REVOKE ALL ON FUNCTION set_player_status(text, text, text)          FROM PUBLIC;
REVOKE ALL ON FUNCTION set_player_paid(text, boolean, text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION set_player_injured(text, boolean)            FROM PUBLIC;
REVOKE ALL ON FUNCTION add_guest_player(text, text)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION set_guest_payment(text, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION player_create_cash_payment_entry(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cast_potm_vote(text, text, text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION get_my_potm_vote(text, text)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION register_push_subscription(text, jsonb)      FROM PUBLIC;
REVOKE ALL ON FUNCTION unregister_push_subscription(text)           FROM PUBLIC;

GRANT EXECUTE ON FUNCTION set_player_status(text, text, text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_player_paid(text, boolean, text)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_player_injured(text, boolean)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION add_guest_player(text, text)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_guest_payment(text, text, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION player_create_cash_payment_entry(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cast_potm_vote(text, text, text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_my_potm_vote(text, text)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION register_push_subscription(text, jsonb)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION unregister_push_subscription(text)           TO anon, authenticated;

-- Internal broadcast helper (also refined by migration 017) — no external grant
REVOKE ALL ON FUNCTION notify_team_change(text, text) FROM PUBLIC;


-- ── Migration 012: admin player management RPCs ──────────────────────────────
-- Admin RPCs validate admin_token internally; callable by authenticated only.
-- anon callers cannot reach admin RPCs (no grant).

REVOKE ALL ON FUNCTION admin_add_player(text, text, text)                FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_delete_player(text, text)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_player_status(text, text, text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_player_priority(text, text, text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_vice_captain(text, text, boolean)              FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_disable_player(text, text, boolean, text)   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_add_player(text, text, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_player(text, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_player_status(text, text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_player_priority(text, text, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_vice_captain(text, text, boolean)           TO authenticated;
GRANT EXECUTE ON FUNCTION admin_disable_player(text, text, boolean, text) TO authenticated;


-- ── Migration 013: admin match / schedule RPCs ────────────────────────────────

REVOKE ALL ON FUNCTION admin_save_match_result(text, text, text, int, int, text, int, text[], text[], jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_save_teams(text, text, text[], text[], boolean)        FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_save_bib_holder(text, text, text)                      FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_upsert_schedule(text, text, text, text, text, int, int, boolean, text, text, int, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_upsert_settings(text, text, text)                      FROM PUBLIC;
-- REVOKE ALL ON FUNCTION admin_add_cover_player(text, text, text)                     FROM PUBLIC;
-- REVOKE ALL ON FUNCTION admin_remove_cover_player(text, text)                        FROM PUBLIC;
-- REVOKE ALL ON FUNCTION admin_update_cover_player(text, text, int, int)             FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_cancel_match(text, text, text)                         FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_save_match_result(text, text, text, int, int, text, int, text[], text[], jsonb, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_save_teams(text, text, text[], text[], boolean)     TO authenticated;
GRANT EXECUTE ON FUNCTION admin_save_bib_holder(text, text, text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION admin_upsert_schedule(text, text, text, text, text, int, int, boolean, text, text, int, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_upsert_settings(text, text, text)                   TO authenticated;
-- GRANT EXECUTE ON FUNCTION admin_add_cover_player(text, text, text)                  TO authenticated;
-- GRANT EXECUTE ON FUNCTION admin_remove_cover_player(text, text)                     TO authenticated;
-- GRANT EXECUTE ON FUNCTION admin_update_cover_player(text, text, int, int)          TO authenticated;
GRANT EXECUTE ON FUNCTION admin_cancel_match(text, text, text)                      TO authenticated;


-- ── Migration 014: admin payment RPCs ─────────────────────────────────────────

REVOKE ALL ON FUNCTION admin_confirm_payment(text, text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_reset_payment(text, text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_clear_debt(text, text)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_waive_debt(text, text, int, text)      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_confirm_payment(text, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reset_payment(text, text, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION admin_clear_debt(text, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION admin_waive_debt(text, text, int, text)      TO authenticated;


-- ── Migration 015: onboarding RPCs ────────────────────────────────────────────
-- Auth required for both onboarding RPCs (auth.uid() used inside)

REVOKE ALL ON FUNCTION create_team(text, text, text, text, int, text, text, int, boolean, text[], text, text, int)              FROM PUBLIC;
REVOKE ALL ON FUNCTION join_team_as_returning_player(text, uuid)     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_team(text, text, text, text, int, text, text, int, boolean, text[], text, text, int)           TO authenticated;
GRANT EXECUTE ON FUNCTION join_team_as_returning_player(text, uuid)  TO authenticated;


-- ── Migration 016: POTM RPCs ───────────────────────────────────────────────────
-- get_potm_tally: admin-only (authenticated; admin_token validated inside)
-- open/close: admin-only (authenticated; admin_token validated inside)

REVOKE ALL ON FUNCTION admin_open_potm_voting(text, text, timestamptz, int)          FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_close_potm_voting(text, text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION get_potm_tally(text)                  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_open_potm_voting(text, text, timestamptz, int)       TO authenticated;
GRANT EXECUTE ON FUNCTION admin_close_potm_voting(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_potm_tally(text)               TO authenticated;


-- ── Migration 017: broadcast helper refinement ────────────────────────────────
-- Already handled in migration 011 block above (same function, same REVOKE).
-- Listed here for completeness; duplicate REVOKE is harmless.

REVOKE ALL ON FUNCTION notify_team_change(text, text) FROM PUBLIC;


-- ── Migration 018: demo RPC ───────────────────────────────────────────────────
-- Anon-callable: no auth required for demo session tracking

REVOKE ALL ON FUNCTION update_demo_interaction(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION update_demo_interaction(text) TO anon, authenticated;


-- =============================================================================
-- SECTION 4: Verification queries
-- =============================================================================
-- Run these after applying the migration to confirm grant state.
-- All queries should return zero rows.

-- [A] Tables that still have non-service grants
-- Expected: 0 rows
SELECT
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'teams','players','team_players','matches','schedule','settings',
    'bib_history','cover_pool','player_match','player_career',
    'player_injuries','payment_ledger','potm_votes','demo_sessions',
    'push_subscriptions','notification_log','audit_events','team_admins'
  )
  AND grantee IN ('anon','authenticated','public')
ORDER BY table_name, grantee;

-- [B] RPCs missing GRANT to expected roles
-- Expected: list of functions callable by anon + authenticated (manual review)
SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND grantee IN ('anon','authenticated')
ORDER BY routine_name, grantee;

-- [C] Views missing SELECT grant
-- Expected: teams_public, players_public, matches_public granted to authenticated
SELECT
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('teams_public','players_public','matches_public')
ORDER BY table_name, grantee;
