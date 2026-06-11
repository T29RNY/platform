-- Down for migration 257 — Equipment Hire V1 hire flow.
DROP FUNCTION IF EXISTS public.venue_list_equipment_hires(text, text, int);
DROP FUNCTION IF EXISTS public.venue_cancel_equipment_hire(text, uuid);
DROP FUNCTION IF EXISTS public.venue_create_equipment_hire(text, uuid, int, timestamptz, timestamptz, text, text, timestamptz, uuid, uuid, text, text, int);
DROP FUNCTION IF EXISTS public.get_equipment_availability(text, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public._equipment_peak_committed(uuid, timestamptz, timestamptz);
