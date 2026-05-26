-- 091_phase2_venue_generate_fixtures_down.sql
--
-- Reverses 091.

DROP FUNCTION IF EXISTS public.venue_generate_fixtures(text, uuid, jsonb);
