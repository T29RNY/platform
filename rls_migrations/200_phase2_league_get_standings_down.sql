-- 200_phase2_league_get_standings_down.sql — rollback for 200
DROP FUNCTION IF EXISTS public.league_get_standings(text, uuid);
