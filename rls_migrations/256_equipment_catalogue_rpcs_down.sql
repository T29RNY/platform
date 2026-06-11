-- Down for migration 256 — Equipment Hire V1 catalogue RPCs.
DROP FUNCTION IF EXISTS public.venue_upsert_equipment(text, text, text, int, uuid, int, int, text, int, date, text, boolean);
DROP FUNCTION IF EXISTS public.venue_list_equipment(text);
