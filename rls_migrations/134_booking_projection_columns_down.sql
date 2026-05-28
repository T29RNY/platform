-- Down for 134 — drop the additive booking-projection columns.
-- Stage 2b / Stage 3+ objects that reference these columns must be
-- rolled back first (later migration numbers down before this one).

ALTER TABLE public.playing_areas DROP COLUMN IF EXISTS booking_windows;
ALTER TABLE public.venues        DROP COLUMN IF EXISTS cancellation_policy;
ALTER TABLE public.venues        DROP COLUMN IF EXISTS bookings_enabled;
ALTER TABLE public.fixtures      DROP COLUMN IF EXISTS slot_minutes;
ALTER TABLE public.league_config DROP COLUMN IF EXISTS slot_minutes;
