-- Down migration 421 — drop the Phase 3b manager home-fixture edit RPCs.
DROP FUNCTION IF EXISTS public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time);
DROP FUNCTION IF EXISTS public.club_manager_get_home_fixture_options(uuid);

SELECT pg_notify('pgrst', 'reload schema');
