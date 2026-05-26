-- 088_phase2_competition_teams_status_check_down.sql
--
-- Restores the pre-Cycle 2.2 narrower CHECK. Note: any rows already
-- carrying 'pending' or 'rejected' would block this down-migration;
-- the down-mig also resets matching values to 'active' first.

UPDATE public.competition_teams
  SET status = 'active'
  WHERE status IN ('pending','rejected');

ALTER TABLE public.competition_teams
  DROP CONSTRAINT IF EXISTS competition_teams_status_check;

ALTER TABLE public.competition_teams
  ADD CONSTRAINT competition_teams_status_check
    CHECK (status IN ('active','withdrawn','expelled'));
