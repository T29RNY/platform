-- 528 DOWN: drop the coach session-board reader. New isolated read-only function; its only
-- consumer is the mobile SessionRsvpSheet, which would then error ("Couldn't load who's
-- available") until it's re-pointed at member_get_session_rsvp_board — so revert the source
-- alongside dropping the function.

DROP FUNCTION IF EXISTS public.club_manager_get_session_board(uuid);

SELECT pg_notify('pgrst', 'reload schema');
