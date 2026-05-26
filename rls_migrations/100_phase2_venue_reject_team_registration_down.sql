-- 100_phase2_venue_reject_team_registration_down.sql
--
-- Reverses 100.

DROP FUNCTION IF EXISTS public.venue_reject_team_registration(text, uuid, text);
