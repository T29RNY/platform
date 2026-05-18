-- Migration 005: Column-masking views for teams, players, and matches.
--
-- Security model for these views:
--   WITH (security_invoker = false) — the default, explicitly stated.
--
--   security_invoker = false means:
--     - Table-level privilege checks use the VIEW OWNER's identity (postgres/superuser).
--       The postgres role has full access to the underlying tables regardless of
--       any REVOKE applied to anon/authenticated.
--     - Row-level security policies are evaluated against the CALLING USER's identity.
--       The calling user's RLS predicates (is_team_member, shares_team_with_player)
--       gate which rows are returned.
--
--   This is the correct model for our access design:
--     - Base tables have REVOKE ALL from anon and authenticated (migration 006).
--     - authenticated users access data through these views (column-masked).
--     - RLS on the base tables gates which rows they see through the view.
--     - anon users access data only via SECURITY DEFINER RPCs (migrations 010-011),
--       which bypass both table-level grants and RLS.
--
--   WHY NOT security_invoker = true (Phase A §4 is corrected):
--     security_invoker = true causes PostgreSQL to check the calling user's
--     table-level privileges. Since migration 006 REVOKEs ALL from authenticated,
--     authenticated users have no table-level SELECT — the view query would fail
--     with a permission error. The column-masking goal is unachievable without
--     also granting SELECT on the base tables, which would allow authenticated
--     users to bypass the view and read sensitive columns directly.
--
-- Grant model (applied at the bottom of this file):
--   - REVOKE ALL on each view from anon and authenticated
--   - GRANT SELECT on each view to authenticated only
--   - anon: no direct view access (uses SECURITY DEFINER RPCs instead)


-- ─────────────────────────────────────────────────────────────────────────────
-- View 1: teams_public
-- Excludes: admin_token (never returned to any client role)
--           admin_email (returned only by admin-token RPCs)
--           live_channel_key (returned only by token-validating RPCs after
--             authorisation — get_my_teams(), get_team_state_by_player_token(),
--             get_team_state_by_admin_token() — per Phase A §11.1; exposing it
--             here would allow authenticated users to subscribe to the realtime
--             broadcast channel without going through a token-validating RPC)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW teams_public
  WITH (security_invoker = false)
AS
SELECT
  id,
  name,
  join_code,
  onboarding_complete,
  created_at
FROM teams;


-- ─────────────────────────────────────────────────────────────────────────────
-- View 2: players_public
-- Excludes: token (bearer auth credential for /p/<token> URLs)
--           user_id (auth identity linkage — privacy + security)
--           paid_at (internal payment timestamp)
--           role_scope (dead column per Phase A §14)
-- Financial columns (paid, owes, self_paid, paid_by, pay_count) are INCLUDED.
-- Stage 1 decision: financial data visible to authenticated team members.
-- Phase 2 will split into players_public (no financials) + players_financial
-- (admin-scoped). See OI-16 from Prompt 3.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW players_public
  WITH (security_invoker = false)
AS
SELECT
  id,
  name,
  nickname,
  status,
  type,
  priority,
  paid,
  owes,
  self_paid,
  paid_by,
  pay_count,
  goals,
  motm,
  attended,
  total,
  w,
  l,
  d,
  bib_count,
  late_dropouts,
  injured,
  injured_since,
  is_guest,
  guest_of,
  note,
  is_vice_captain,
  disabled,
  disable_reason,
  team
FROM players;


-- ─────────────────────────────────────────────────────────────────────────────
-- View 3: matches_public
-- Excludes: teams_draft (uncommitted draft bib-assignment state, admin-only)
--           payments (jsonb payment map, superseded by payment_ledger table)
--
-- Column names verified against live schema (supabase.js matchToDb/dbToMatch,
-- confirmed 2026-05-18):
--   match_date    — on matches (NOT game_date_time; that column is on schedule)
--   cancelled     — on matches (NOT is_cancelled; schedule uses is_cancelled)
--   winner        — stored on matches, not computed at read time
--   scorers       — jsonb/array column on matches
--   bib_holder    — stored on matches directly; also tracked in bib_history
--   voting_open, voting_closes_at, vote_count, total_voters,
--   was_admin_decided, admin_decision_pending, tied_candidates — all on matches
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW matches_public
  WITH (security_invoker = false)
AS
SELECT
  id,
  team_id,
  match_date,
  score_a,
  score_b,
  score_type,
  last_goal_scorer,
  scorers,
  motm,
  bib_holder,
  team_a,
  team_b,
  winner,
  cancelled,
  cancel_reason,
  voting_open,
  voting_closes_at,
  vote_count,
  total_voters,
  was_admin_decided,
  admin_decision_pending,
  tied_candidates,
  created_at
FROM matches;


-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON teams_public FROM anon;
REVOKE ALL ON teams_public FROM authenticated;
GRANT SELECT ON teams_public TO authenticated;

REVOKE ALL ON players_public FROM anon;
REVOKE ALL ON players_public FROM authenticated;
GRANT SELECT ON players_public TO authenticated;

REVOKE ALL ON matches_public FROM anon;
REVOKE ALL ON matches_public FROM authenticated;
GRANT SELECT ON matches_public TO authenticated;

-- anon intentionally receives no SELECT on any view.
-- anon accesses team, player, and match data exclusively through
-- SECURITY DEFINER RPCs (migrations 010, 011) which bypass RLS and
-- return column-filtered jsonb payloads.