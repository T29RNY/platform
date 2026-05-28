-- Down for 137 — remove the fixture mirror trigger + its rows.

DROP TRIGGER IF EXISTS sync_fixture_occupancy ON public.fixtures;
DROP FUNCTION IF EXISTS public.tg_sync_fixture_occupancy();
DELETE FROM public.pitch_occupancy WHERE source_kind = 'fixture';
