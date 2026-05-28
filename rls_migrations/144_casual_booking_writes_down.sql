-- Down for 144 — drop the casual booking-request RPCs.

DROP FUNCTION IF EXISTS public.book_pitch_adhoc(text, uuid, date, time, int);
DROP FUNCTION IF EXISTS public.book_pitch_series(text, uuid, time, date, int, int);
