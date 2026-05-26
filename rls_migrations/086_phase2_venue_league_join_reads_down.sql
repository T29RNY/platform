-- 086_phase2_venue_league_join_reads_down.sql
--
-- Reverses 086. Drops the three Phase 2 Cycle 2.2 read RPCs.

DROP FUNCTION IF EXISTS public.join_get_league_by_code(text);
DROP FUNCTION IF EXISTS public.league_get_state(text);
DROP FUNCTION IF EXISTS public.venue_get_state(text);
