-- Down for migration 178 — drop hq_get_utilisation.
DROP FUNCTION IF EXISTS public.hq_get_utilisation(text, date, date);
