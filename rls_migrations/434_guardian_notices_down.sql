-- Down for 434 — Guardian "Club notices" inbox.
DROP FUNCTION IF EXISTS public.guardian_mark_notice_read(uuid, text);
DROP FUNCTION IF EXISTS public.guardian_list_child_notices(text);
DROP TABLE IF EXISTS public.club_announcement_reads;
