-- 203_phase2_league_reschedule_fixture_down.sql — rollback for 203
DROP FUNCTION IF EXISTS public.league_reschedule_fixture(text, uuid, date, time, text);
