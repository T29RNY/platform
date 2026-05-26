-- 093_phase2_fixture_forfeit_support.sql
--
-- Phase 2 (League Mode) — Cycle 2.4 schema foundation for fixture
-- management. Adds forfeit storage + extends the fixtures.status
-- CHECK enum to include 'forfeit'.
--
-- Walkover and forfeit are semantically distinct and stored in
-- separate columns so reporting can label them differently:
--   walkover (mig 055): pre-match no-show, default 3-0 to
--     walkover_winner_id. Already supported.
--   forfeit (this migration): post-result reversal for eligibility
--     or misconduct. Awarded to forfeit_winner_id, with
--     forfeit_reason capturing the disciplinary note. Can apply
--     from {scheduled,allocated,completed}.
--
-- Caught in Cycle 2.4 audit via the new pg_constraint sweep
-- mandate (DECISIONS.md session 48): fixtures_status_check only
-- allowed seven values, missing 'forfeit'. Setting status='forfeit'
-- from any RPC would have raised fixtures_status_check violation —
-- same failure class as mig 088 / mig 092.
--
-- Additive: no existing rows touched (Phase 1 tables empty in prod).

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS forfeit_winner_id text
    REFERENCES public.teams(id) ON DELETE SET NULL;

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS forfeit_reason text;

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
      'walkover',
      'forfeit'
    ));
