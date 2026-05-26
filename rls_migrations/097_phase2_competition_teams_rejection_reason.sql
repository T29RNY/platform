-- 097_phase2_competition_teams_rejection_reason.sql
--
-- Phase 2 (League Mode) — Cycle 2.5a schema foundation for team
-- registration. Adds rejection_reason to mirror the existing
-- withdrawal_reason column.
--
-- competition_teams already had:
--   withdrawal_reason text NULL — set when status → 'withdrawn'
--
-- This adds:
--   rejection_reason text NULL — set when status → 'rejected'
--
-- Additive only. No CHECK changes. Existing rows untouched
-- (Phase 1 tables empty in prod).

ALTER TABLE public.competition_teams
  ADD COLUMN IF NOT EXISTS rejection_reason text;
