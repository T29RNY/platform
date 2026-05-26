-- 097_phase2_competition_teams_rejection_reason_down.sql
--
-- Reverses 097.

ALTER TABLE public.competition_teams DROP COLUMN IF EXISTS rejection_reason;
