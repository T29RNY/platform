-- ============================================================
-- Rollback 012: remove admin player management RPCs
-- WARNING: After rollback, combined with RLS lockdown (006-009),
-- admin cannot modify players at all via client calls.
-- Only run as part of a coordinated full RLS rollback.
-- ============================================================

-- Drop in reverse creation order
DROP FUNCTION IF EXISTS admin_delete_player(text, text);
DROP FUNCTION IF EXISTS admin_update_player_name(text, text, text, text);
DROP FUNCTION IF EXISTS admin_add_player(text, text, text, boolean);
DROP FUNCTION IF EXISTS admin_disable_player(text, text, boolean, text);
DROP FUNCTION IF EXISTS admin_set_vice_captain(text, text, boolean);
DROP FUNCTION IF EXISTS admin_set_player_priority(text, text, boolean);
DROP FUNCTION IF EXISTS admin_set_player_injured(text, text, boolean);
DROP FUNCTION IF EXISTS admin_set_player_note(text, text, text);
DROP FUNCTION IF EXISTS admin_set_player_status(text, text, text);