-- Down — Migration 249 (get_venue_landing)
DROP FUNCTION IF EXISTS public.get_venue_landing(text);
SELECT pg_notify('pgrst', 'reload schema');
