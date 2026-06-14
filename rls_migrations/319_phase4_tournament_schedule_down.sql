-- Down migration for 319 — removes Phase 4 scheduling additions

DROP FUNCTION IF EXISTS public.club_admin_assign_fixture_slot(uuid, date, time, uuid, int);
DROP FUNCTION IF EXISTS public.club_admin_get_schedule(uuid);
DROP FUNCTION IF EXISTS public.club_admin_generate_schedule(uuid, uuid, int, time, date, uuid[]);

ALTER TABLE public.fixtures DROP CONSTRAINT IF EXISTS fixtures_home_identity;
ALTER TABLE public.fixtures ALTER COLUMN home_team_id SET NOT NULL;
ALTER TABLE public.fixtures DROP COLUMN IF EXISTS away_competition_team_id;
ALTER TABLE public.fixtures DROP COLUMN IF EXISTS home_competition_team_id;
