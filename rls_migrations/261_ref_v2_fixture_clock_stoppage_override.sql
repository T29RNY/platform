-- Migration 261 — Ref V2: fixture clock pause, stoppage time, per-fixture format override.
-- Cycle "RefSix-killer" / apps/ref/REF_V2_BUILD_PLAN.md, schema change M1.
--
-- The match clock becomes PAUSABLE per-fixture, and stoppage ("added") time becomes
-- persisted so it can be advertised on the reception/venue screens. A per-fixture
-- timing override lets a ref/venue deviate from the league's configured match format,
-- and its mere presence is the "this match was changed" flag surfaced for fairness.
--
-- CLOCK MODEL (single source of truth = this row; computed identically on every client):
--   elapsed = now − actual_kickoff_at − clock_paused_ms − (clock_paused_at ? now − clock_paused_at : 0)
--
--   clock_paused_at  — timestamptz when the CURRENT pause began; NULL = clock running.
--   clock_paused_ms  — accumulated paused time in ms across all completed pause intervals.
--                      On resume: clock_paused_ms += (resume_ts − clock_paused_at); clock_paused_at→NULL.
--                      Offline-safe: pause/resume carry the CLIENT timestamp, so a queued
--                      pause reconstructs the exact frozen duration on drain.
--
-- STOPPAGE TIME (distinct from pause — pause freezes the clock; added time is displayed extra):
--   added_time  — jsonb map of period → whole minutes, e.g. {"1H":2,"2H":4}. Mutable
--                 (the ref nudges +3→+4 mid-half). Renders as "45 +3" on screens.
--
-- FORMAT OVERRIDE (per-fixture deviation from the resolved league/competition config):
--   format_override — jsonb, NULL = inherit. When present the fixture's timing differs
--                     from the league default; consumers treat non-NULL as the override flag.
--
-- Pause is PER-MATCH: these columns live on the individual fixture, so pausing fixture X
-- freezes only fixture X wherever it is shown; every other match keeps ticking.

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS clock_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS clock_paused_ms bigint  NOT NULL DEFAULT 0 CHECK (clock_paused_ms >= 0),
  ADD COLUMN IF NOT EXISTS added_time      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS format_override jsonb;
