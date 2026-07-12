-- 566 DOWN: drop the venue coach-request approve/decline/reader + notify helper (all
-- additive new functions, no dependents beyond the same-PR wrappers/UI).
DROP FUNCTION IF EXISTS public.venue_approve_coach_request(text, uuid);
DROP FUNCTION IF EXISTS public.venue_decline_coach_request(text, uuid);
DROP FUNCTION IF EXISTS public.venue_list_coach_requests(text);
DROP FUNCTION IF EXISTS public._notify_coach_request(uuid, text);
SELECT pg_notify('pgrst', 'reload schema');
