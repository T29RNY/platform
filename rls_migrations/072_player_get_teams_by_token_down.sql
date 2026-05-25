-- Rollback for migration 072.
DROP FUNCTION IF EXISTS public.player_get_teams_by_token(text);
