-- Migration 262 — Ref V2: match_events note_text + sin-bin duration.
-- Cycle "RefSix-killer" / apps/ref/REF_V2_BUILD_PLAN.md, schema change M2.
--
-- Two new event kinds the referee can now record, both stored as ordinary match_events
-- rows (event_type stays OPEN TEXT for sport-extensibility — no new constraint):
--
--   note_text — free-text incident note for event_type='note' (dissent, injury,
--               timewasting, abuse, equipment…). Optionally attached to a player.
--   duration  — sin-bin length in whole minutes for event_type='sin_bin' (e.g. 10).
--               The countdown badge + "may return" alert derive from minute + duration.
--
-- Purely additive. Existing rows are unaffected (both columns default NULL).

ALTER TABLE public.match_events
  ADD COLUMN IF NOT EXISTS note_text text,
  ADD COLUMN IF NOT EXISTS duration  integer CHECK (duration IS NULL OR duration > 0);
