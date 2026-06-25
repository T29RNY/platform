-- Down for migration 433 — remove the Guardian Schedule demo seed rows only.
DELETE FROM public.venue_class_bookings WHERE id = 'b0000000-0000-4000-8000-000000000433';
DELETE FROM public.venue_class_sessions WHERE id = 'e5000000-0000-4000-8000-000000000433';
DELETE FROM public.club_sessions
 WHERE id IN ('aa000000-0000-4000-8000-000000000433', 'aa000000-0000-4000-8000-000000000434');
