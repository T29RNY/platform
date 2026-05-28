-- Down for 146 — drop the cancellation RPCs.

DROP FUNCTION IF EXISTS public.cancel_booking(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_booking_series(uuid, text);
