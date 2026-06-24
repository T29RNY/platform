-- Down for 424 — drop the resource_occupancy clash-protection ledger + its triggers.
-- Rooms fall back to the inline _space_is_available guard; trainers to the inline
-- overlap-count + exact-start unique index. No data loss outside the ledger itself.

DROP TRIGGER IF EXISTS sync_room_hire_occupancy     ON public.venue_room_hires;
DROP TRIGGER IF EXISTS sync_class_session_occupancy ON public.venue_class_sessions;
DROP TRIGGER IF EXISTS sync_appointment_occupancy   ON public.venue_appointments;

DROP FUNCTION IF EXISTS public.tg_sync_room_hire_occupancy();
DROP FUNCTION IF EXISTS public.tg_sync_class_session_occupancy();
DROP FUNCTION IF EXISTS public.tg_sync_appointment_occupancy();

DROP TABLE IF EXISTS public.resource_occupancy;

SELECT pg_notify('pgrst', 'reload schema');
