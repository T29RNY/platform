-- 419_venue_resource_occupancy_down.sql
-- Revert the Unified Resource Calendar Phase-1 reader + its two detail builders.
-- Phase 1 is read-only and additive (no schema change, no existing function altered),
-- so the down simply drops the three new functions. The pitch readers and
-- _pitch_occupancy_detail are untouched by 419 and remain in place.
DROP FUNCTION IF EXISTS public.get_venue_resource_occupancy(text, date, date);
DROP FUNCTION IF EXISTS public._room_occupancy_detail(text, text);
DROP FUNCTION IF EXISTS public._trainer_occupancy_detail(text);

SELECT pg_notify('pgrst', 'reload schema');
