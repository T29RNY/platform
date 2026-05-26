-- 085_phase2_superadmin_create_venue_down.sql
--
-- Reverses 085. Drops the onboarding RPC.

DROP FUNCTION IF EXISTS public.superadmin_create_venue(text, text, text, jsonb);
