-- 090_phase2_venue_create_season_down.sql
--
-- Reverses 090. Drops the season creation RPC.

DROP FUNCTION IF EXISTS public.venue_create_season(text, jsonb);
