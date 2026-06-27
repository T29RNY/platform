-- 442 DOWN — referee availability + accept/decline.
DROP FUNCTION IF EXISTS public.venue_get_ref_responses(text);
DROP FUNCTION IF EXISTS public.get_my_ref_status();
DROP FUNCTION IF EXISTS public.ref_remove_unavailability(uuid);
DROP FUNCTION IF EXISTS public.ref_add_unavailability(date, date, text);
DROP FUNCTION IF EXISTS public.ref_respond_to_assignment(text, text, text);
DROP TABLE IF EXISTS public.ref_unavailability;
DROP TABLE IF EXISTS public.ref_assignment_responses;
SELECT pg_notify('pgrst', 'reload schema');
