-- 202_phase2_league_update_fixture_status_down.sql — rollback for 202
DROP FUNCTION IF EXISTS public.league_update_fixture_status(text, uuid, text, jsonb);
