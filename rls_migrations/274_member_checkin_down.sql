-- 274_member_checkin_down.sql — reverse of 274_member_checkin.sql
DROP FUNCTION IF EXISTS public.member_check_in(text,text);
DROP TABLE IF EXISTS public.venue_member_checkins;
