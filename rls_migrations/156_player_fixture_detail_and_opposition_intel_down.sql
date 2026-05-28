-- 156_player_fixture_detail_and_opposition_intel_down.sql
--
-- Rollback for Cycle 5.4. Drops the two read-only player-facing RPCs.
-- No data, no schema change to reverse.

DROP FUNCTION IF EXISTS public.get_player_fixture_detail(text, uuid);
DROP FUNCTION IF EXISTS public.get_fixture_opposition_intel(text, uuid);
