-- Down for 416 — drop the Phase 1 reserved-window foundation.
-- No earlier migration depends on this table or these functions (net-new in 416).

DROP FUNCTION IF EXISTS public.venue_list_pitch_reserved_windows(text);
DROP FUNCTION IF EXISTS public.venue_set_pitch_reserved_windows(text, uuid, jsonb);
DROP TABLE IF EXISTS public.pitch_reserved_windows;

SELECT pg_notify('pgrst', 'reload schema');
