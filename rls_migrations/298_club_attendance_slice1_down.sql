-- Down: 298_club_attendance_slice1
-- Removes all Phase 10 Slice 1 objects.

DROP FUNCTION IF EXISTS public.club_mark_attendance(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.club_get_session_rsvps(text, uuid);
DROP FUNCTION IF EXISTS public.club_list_sessions(text, text, uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.club_cancel_session(text, uuid, text);
DROP FUNCTION IF EXISTS public.club_update_session(text, uuid, text, timestamptz, text, text, integer);
DROP FUNCTION IF EXISTS public.club_create_session(text, text, text, timestamptz, uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.club_update_cohort(text, uuid, text, text, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.club_list_cohorts(text, text, boolean);
DROP FUNCTION IF EXISTS public.club_create_cohort(text, text, text, text, integer, integer);

DROP TABLE IF EXISTS public.club_session_attendance;
DROP TABLE IF EXISTS public.club_session_rsvps;
DROP TABLE IF EXISTS public.club_sessions;
