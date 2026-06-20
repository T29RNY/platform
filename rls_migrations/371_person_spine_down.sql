-- DOWN for 371: canonical person spine (Phase 0a)
-- Removes triggers, trigger fns, helper, person_id columns, and the people table.
-- person_id ON DELETE SET NULL means dropping people first would null the columns anyway;
-- we drop columns explicitly then the table.

DROP TRIGGER IF EXISTS trg_players_person_id         ON public.players;
DROP TRIGGER IF EXISTS trg_match_officials_person_id ON public.match_officials;
DROP TRIGGER IF EXISTS trg_team_admins_person_id     ON public.team_admins;
DROP TRIGGER IF EXISTS trg_venue_admins_person_id    ON public.venue_admins;
DROP TRIGGER IF EXISTS trg_member_profiles_person_id ON public.member_profiles;

DROP FUNCTION IF EXISTS public.tg_set_person_id_from_user_id();
DROP FUNCTION IF EXISTS public.tg_set_person_id_from_auth_user_id();
DROP FUNCTION IF EXISTS public.ensure_person(uuid);

ALTER TABLE public.players         DROP COLUMN IF EXISTS person_id;
ALTER TABLE public.member_profiles DROP COLUMN IF EXISTS person_id;
ALTER TABLE public.match_officials DROP COLUMN IF EXISTS person_id;
ALTER TABLE public.team_admins     DROP COLUMN IF EXISTS person_id;
ALTER TABLE public.venue_admins    DROP COLUMN IF EXISTS person_id;

DROP TABLE IF EXISTS public.people;
