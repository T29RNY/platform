-- Down for 136 — remove the maintenance projection trigger + its rows.

DROP TRIGGER IF EXISTS sync_maintenance_occupancy ON public.playing_areas;
DROP FUNCTION IF EXISTS public.tg_sync_maintenance_occupancy();
DELETE FROM public.pitch_occupancy WHERE source_kind = 'maintenance';
