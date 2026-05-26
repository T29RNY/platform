-- 095_phase2_venue_assign_ref_down.sql
--
-- Reverses 095.

DROP FUNCTION IF EXISTS public.venue_assign_ref(text, uuid, uuid);
