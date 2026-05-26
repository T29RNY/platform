-- Down migration for 078_group_rpcs_anon_grant.
-- Restores the mig 031 grant state: authenticated-only on both
-- group balancer RPCs. Note this reintroduces the bug — only use
-- if rolling back the parity fix is genuinely desired.

REVOKE EXECUTE ON FUNCTION admin_set_player_group(text, text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION admin_clear_all_groups(text)            FROM anon;
