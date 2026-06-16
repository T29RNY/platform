-- 343_class_qr_checkin_down.sql — reverse of 343_class_qr_checkin.sql
DROP FUNCTION IF EXISTS public.venue_class_checkin(text,uuid,text);
ALTER TABLE public.venue_class_bookings DROP COLUMN IF EXISTS checked_in_at;
