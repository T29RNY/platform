-- Down migration 426 — Guardian fixture availability.
DROP FUNCTION IF EXISTS public.guardian_list_child_fixtures(uuid);
DROP FUNCTION IF EXISTS public.guardian_set_fixture_availability(uuid, text, uuid);
DROP TABLE IF EXISTS public.club_fixture_availability;
