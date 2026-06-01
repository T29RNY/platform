-- 186_phase11_knockout_result_columns.sql
-- LEAGUE MODE — Phase 11 Cycle 11.2: knockout decider columns on fixtures.
--
-- A knockout tie can't end level. When regulation is level the ref enters a decider
-- (extra time and/or penalties — typed, not event-tracked) and picks the winner. These
-- columns capture that:
--   * aet_home_score / aet_away_score   — extra-time goals (NULL if no ET played)
--   * pens_home_score / pens_away_score — shootout score (NULL if no shootout)
--   * ko_winner_id                      — the tie winner when not derivable from the
--                                         regulation score (i.e. level → decided by ET/pens)
--   * decided_by                        — 'regulation' | 'extra_time' | 'penalties' |
--                                         'walkover' | 'forfeit' (NULL for league/unfinished)
--
-- home_score/away_score keep their existing meaning (regulation goals). League fixtures
-- never touch these columns. Additive only — no status enum change (a level cup tie stays
-- 'in_progress' until the decider RPC completes it).

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS aet_home_score  int,
  ADD COLUMN IF NOT EXISTS aet_away_score  int,
  ADD COLUMN IF NOT EXISTS pens_home_score int,
  ADD COLUMN IF NOT EXISTS pens_away_score int,
  ADD COLUMN IF NOT EXISTS ko_winner_id    text REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_by      text;
