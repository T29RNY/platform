-- Migration 307 DOWN — remove club comms
DROP FUNCTION IF EXISTS public.member_list_club_announcements(text);
DROP FUNCTION IF EXISTS public.get_pending_club_broadcasts();
DROP FUNCTION IF EXISTS public.club_send_announcement(text, text, text, text, text, uuid, uuid);
DROP TABLE IF EXISTS public.club_announcements;
