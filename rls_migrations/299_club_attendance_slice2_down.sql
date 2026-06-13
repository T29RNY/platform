-- Down migration 299 — drop Slice 2 member RPCs
DROP FUNCTION IF EXISTS public.member_list_upcoming_sessions(text, uuid);
DROP FUNCTION IF EXISTS public.member_rsvp_session(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.member_get_session_rsvp_board(uuid);
