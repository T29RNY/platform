-- 340_member_class_booking_down.sql — reverse of 340_member_class_booking.sql
--
-- Drops the 4 member RPCs + internal helper, then the venue_class_bookings table,
-- then the two additive columns. Does NOT undo mig 339's forward-guarded cascades —
-- once the bookings table is gone they revert to harmless no-ops automatically.

DROP FUNCTION IF EXISTS public.member_list_my_class_bookings(text);
DROP FUNCTION IF EXISTS public.member_cancel_class_booking(uuid);
DROP FUNCTION IF EXISTS public.member_book_class_session(uuid);
DROP FUNCTION IF EXISTS public.member_list_class_sessions(text,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS public._apply_class_booking_charge(uuid);

DROP TABLE IF EXISTS public.venue_class_bookings;

ALTER TABLE public.venues          DROP COLUMN IF EXISTS no_show_suspension_threshold;
ALTER TABLE public.member_profiles DROP COLUMN IF EXISTS no_show_count;

SELECT pg_notify('pgrst', 'reload schema');
