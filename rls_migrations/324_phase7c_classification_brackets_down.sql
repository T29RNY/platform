-- Down migration for 324 — Phase 7C Classification Brackets
-- Removes the new schema columns and new functions.
-- NOTE: The REPLACE'd functions (ref_confirm_tournament_match, club_admin_get_standings,
-- club_admin_get_schedule, get_tournament_public, club_admin_get_tournament) are NOT
-- automatically restored — roll back by re-applying mig 323 bodies manually if needed.

DROP FUNCTION IF EXISTS public.club_admin_seed_knockout(uuid, uuid);
DROP FUNCTION IF EXISTS public._advance_tournament_winner(uuid);

ALTER TABLE public.competition_teams DROP COLUMN IF EXISTS group_rank;
ALTER TABLE public.fixtures DROP COLUMN IF EXISTS knockout_away_feeder_id;
ALTER TABLE public.fixtures DROP COLUMN IF EXISTS knockout_home_feeder_id;

-- Restore original fixtures_home_identity (feeder columns gone, no longer needed)
ALTER TABLE public.fixtures DROP CONSTRAINT IF EXISTS fixtures_home_identity;
ALTER TABLE public.fixtures ADD CONSTRAINT fixtures_home_identity CHECK (
  (home_team_id IS NOT NULL) OR (home_competition_team_id IS NOT NULL)
);
