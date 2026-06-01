-- 201_phase2_league_update_fixture_result_down.sql — rollback for 201
DROP FUNCTION IF EXISTS public.league_update_fixture_result(text, uuid, integer, integer, text);
