-- Down — Migration 252 (get_display_landing_code)
DROP FUNCTION IF EXISTS public.get_display_landing_code(text);
SELECT pg_notify('pgrst', 'reload schema');
