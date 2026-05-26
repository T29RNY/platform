-- 093_phase2_fixture_forfeit_support_down.sql
--
-- Reverses 093. Restores the pre-Cycle-2.4 CHECK enum and drops the
-- two forfeit columns. Safe to run because Phase 1 tables are empty
-- in prod (no rows will collide with the narrowed CHECK or be lost).

ALTER TABLE public.fixtures
  DROP CONSTRAINT IF EXISTS fixtures_status_check;

ALTER TABLE public.fixtures
  ADD CONSTRAINT fixtures_status_check
    CHECK (status IN (
      'scheduled',
      'allocated',
      'in_progress',
      'completed',
      'postponed',
      'void',
      'walkover'
    ));

ALTER TABLE public.fixtures DROP COLUMN IF EXISTS forfeit_reason;
ALTER TABLE public.fixtures DROP COLUMN IF EXISTS forfeit_winner_id;
