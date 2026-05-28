-- 155_player_competition_fixtures_down.sql
--
-- Rollback for Cycle 5.3 player competition fixtures RPC.
-- Drops the read-only function. No data, no schema change to reverse.

DROP FUNCTION IF EXISTS public.get_player_competition_fixtures(text, text);
