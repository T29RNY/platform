-- Rollback for migration 001.
-- Drop all helper functions.
--
-- Safe to run only after all RLS policies that reference the predicate helpers
-- have been dropped (migrations 006–009 add those policies; run their _down
-- counterparts first if rolling back from a later migration state).
--
-- generate_url_safe_token has no RLS dependencies and can be dropped at any time.

DROP FUNCTION IF EXISTS is_team_member(text);
DROP FUNCTION IF EXISTS shares_team_with_player(text);
DROP FUNCTION IF EXISTS shares_team_with_user(uuid);
DROP FUNCTION IF EXISTS is_my_player_id(text);
DROP FUNCTION IF EXISTS generate_url_safe_token(text, int);