-- 169_venues_region_down.sql — revert mig 169.
ALTER TABLE public.venues DROP COLUMN IF EXISTS region;
