-- Migration 078: grant anon execute on group balancer RPCs
-- Applied to remote 2026-05-26 via MCP. Verified post-apply:
--   • admin_set_player_group grants now include anon
--   • admin_clear_all_groups grants now include anon
--
-- Closes the residual gap from mig 031: admin_set_player_group and
-- admin_clear_all_groups were granted to authenticated only, which
-- broke the anon-admin flow (admin opens /admin/<token> URL in a
-- session without a JWT) and the VC flow (VCs always come through
-- anon since they authenticate via player_token, not auth.uid()).
--
-- Brings these two RPCs in line with every other admin_* RPC and
-- with the session-45 "blanket VC = owner parity" sweep (mig 075),
-- which rewrote bodies via resolve_admin_caller but explicitly did
-- not touch grants. The anon revoke from mig 031 was inherited.
--
-- Surfaced 2026-05-26 in rockybram's brand-new squad "Footy
-- Tuesdays" — every group balancer tap returned "Failed to save
-- group, try again". Body and data verified healthy via direct
-- postgres-role call (returned ok=true, wrote audit_events row);
-- only the grant blocked PostgREST callers.

GRANT EXECUTE ON FUNCTION admin_set_player_group(text, text, int) TO anon;
GRANT EXECUTE ON FUNCTION admin_clear_all_groups(text)            TO anon;
