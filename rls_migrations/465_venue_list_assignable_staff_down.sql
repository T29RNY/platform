-- 465_venue_list_assignable_staff_down.sql
DROP FUNCTION IF EXISTS public.venue_list_assignable_staff(text);
SELECT pg_notify('pgrst', 'reload schema');
