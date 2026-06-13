-- Down: Slice 4D — manager write RPCs
DROP FUNCTION IF EXISTS public.club_manager_create_session(uuid, text, timestamptz, text, text, text, integer, timestamptz, text, text, text, text);
DROP FUNCTION IF EXISTS public.club_manager_create_session_series(uuid, text, integer, time, date, date, text, text, text, integer);
DROP FUNCTION IF EXISTS public.club_manager_cancel_session(uuid, text);
DROP FUNCTION IF EXISTS public.club_manager_get_team_members(uuid, uuid);
DROP FUNCTION IF EXISTS public.club_manager_add_session_guest(uuid, uuid);
DROP FUNCTION IF EXISTS public.club_manager_remove_session_guest(uuid, uuid);
