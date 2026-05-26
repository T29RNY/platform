-- 099_phase2_venue_approve_team_registration_down.sql
--
-- Reverses 099.

DROP FUNCTION IF EXISTS public.venue_approve_team_registration(text, uuid);
