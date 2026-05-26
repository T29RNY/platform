-- 096_phase2_venue_update_fixture_status_down.sql
--
-- Reverses 096.

DROP FUNCTION IF EXISTS public.venue_update_fixture_status(text, uuid, text, jsonb);
