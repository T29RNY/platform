-- 088_phase2_competition_teams_status_check.sql
--
-- Cycle 2.2 hotfix. Mig 083 flipped competition_teams.status DEFAULT
-- from 'active' to 'pending' for the Phase 2 manual-approval flow,
-- but the live CHECK constraint (from mig 055) only allowed
-- ('active','withdrawn','expelled'). Result: any INSERT without an
-- explicit status value failed the check — a latent bug across the
-- whole new registration flow.
--
-- Caught during Cycle 2.2 seed of test data; not yet visible to any
-- caller because no Phase 2 client code has shipped that exercises
-- competition_teams INSERT.
--
-- Fix: replace the constraint with the full Phase 2 enum:
--   pending  — submitted via /join/CODE, awaiting venue admin approval
--   active   — approved, playing
--   rejected — venue admin declined (terminal)
--   withdrawn — team withdrew mid-season (terminal)
--   expelled — venue removed the team (terminal)

ALTER TABLE public.competition_teams
  DROP CONSTRAINT IF EXISTS competition_teams_status_check;

ALTER TABLE public.competition_teams
  ADD CONSTRAINT competition_teams_status_check
    CHECK (status IN ('pending','active','rejected','withdrawn','expelled'));
