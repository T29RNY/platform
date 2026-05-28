-- Down for 139 — drop the booking storage tables.
-- pitch_bookings first (FK → booking_series).

DROP TABLE IF EXISTS public.pitch_bookings;
DROP TABLE IF EXISTS public.booking_series;
