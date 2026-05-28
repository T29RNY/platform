-- Down for 140 — drop the casual discovery reads.

DROP FUNCTION IF EXISTS public.get_pitch_free_slots(text, date, uuid, int);
DROP FUNCTION IF EXISTS public.search_bookable_venues(text);
