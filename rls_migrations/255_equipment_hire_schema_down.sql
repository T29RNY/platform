-- Down for migration 255 — Equipment Hire V1 schema.
-- Drops the three equipment tables and restores the venue_charges source_type
-- CHECK to its pre-255 ('booking','fixture') domain.
-- NOTE: any venue_charges rows with source_type='equipment' must be cleared first
-- or the constraint re-add will fail (none exist until Cycle 2 creates hires).

ALTER TABLE public.venue_charges DROP CONSTRAINT venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD  CONSTRAINT venue_charges_source_type_check
  CHECK (source_type IN ('booking','fixture'));

DROP TABLE IF EXISTS public.equipment_demand_misses;
DROP TABLE IF EXISTS public.equipment_bookings;
DROP TABLE IF EXISTS public.equipment;
