-- ============================================================
-- Rollback 011: remove token-based write RPCs and broadcast helper
-- WARNING: After rollback, combined with RLS lockdown (006-009),
-- the app becomes entirely read-only for client callers. Only run
-- as part of a coordinated full RLS rollback.
-- ============================================================

-- Drop in reverse creation order
DROP FUNCTION IF EXISTS get_my_potm_vote(text, text);
DROP FUNCTION IF EXISTS cast_potm_vote(text, text, text);
DROP FUNCTION IF EXISTS unregister_push_subscription(text);
DROP FUNCTION IF EXISTS register_push_subscription(text, jsonb);
DROP FUNCTION IF EXISTS player_create_cash_payment_entry(text);
DROP FUNCTION IF EXISTS set_guest_payment(text, text, text);
DROP FUNCTION IF EXISTS add_guest_player(text, text);
DROP FUNCTION IF EXISTS set_player_injured(text, boolean);
DROP FUNCTION IF EXISTS set_player_paid(text);
DROP FUNCTION IF EXISTS set_player_status(text, text);
DROP FUNCTION IF EXISTS notify_team_change(text, text);