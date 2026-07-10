-- 528 DOWN: drop the coach session-board reader. New isolated read-only function, no
-- dependents (its only consumer is the mobile SessionRsvpSheet, which falls back to
-- member_get_session_rsvp_board if this is absent).

DROP FUNCTION IF EXISTS public.club_manager_get_session_board(uuid);

SELECT pg_notify('pgrst', 'reload schema');
