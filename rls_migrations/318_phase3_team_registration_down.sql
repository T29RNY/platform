-- Migration 318 DOWN — reverses Phase 3 team registration
-- NOTE: dropping tournament_invitations and competition schema changes will
-- fail if rows exist. Only run this on a clean/dev database.

DROP FUNCTION IF EXISTS public.club_admin_get_tournament(text);
DROP FUNCTION IF EXISTS public.get_tournament_public(text);
DROP FUNCTION IF EXISTS public.tournament_join_via_invite(text, text);
DROP FUNCTION IF EXISTS public.club_admin_reject_team(uuid, text);
DROP FUNCTION IF EXISTS public.club_admin_approve_team(uuid);
DROP FUNCTION IF EXISTS public.club_admin_send_team_invite(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.club_admin_register_team(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.club_admin_add_competition(uuid, text, text, text);

DROP TABLE IF EXISTS public.tournament_invitations;

ALTER TABLE public.competition_teams DROP CONSTRAINT IF EXISTS ct_team_identity_check;
ALTER TABLE public.competition_teams DROP COLUMN IF EXISTS team_name;
ALTER TABLE public.competition_teams ALTER COLUMN team_id SET NOT NULL;

ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_identity_check;
ALTER TABLE public.competitions ALTER COLUMN season_id SET NOT NULL;
