-- 157_reset_status_on_fixture_played_down.sql
--
-- Rollback for Cycle 5.5 "start fresh each game" trigger. Drops the trigger and
-- its function. No data or schema change to reverse.

DROP TRIGGER IF EXISTS trg_reset_status_on_fixture_played ON public.fixtures;
DROP FUNCTION IF EXISTS public.reset_team_status_on_fixture_played();
