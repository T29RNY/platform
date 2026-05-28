-- Down for 145 — drop the venue-operator booking RPCs.

DROP FUNCTION IF EXISTS public.venue_create_booking(text, uuid, date, time, int, text, text);
DROP FUNCTION IF EXISTS public.venue_confirm_booking(text, uuid);
DROP FUNCTION IF EXISTS public.venue_decline_booking(text, uuid);
