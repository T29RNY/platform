-- 161_league_config_squad_size.sql
-- League Mode Cycle 5.7, STAGE A (part 1) — squad-size config for teamsheet enforcement.
--
-- Two nullable per-league bounds on the matchday teamsheet, set by the league/venue:
--   min_starting — minimum named STARTERS (5 for 5-a-side, 7 for 7-a-side, 11, …)
--   max_subs     — maximum BENCH size (could be 3, could be 15)
-- NULL = unbounded → every existing league is unaffected (no backfill needed).
-- Enforced by team_admin_submit_lineup (mig 162). get_league_config returns to_jsonb(*),
-- so both columns flow through additively with no JS mapper change (hard-rule #12 safe:
-- additive only).

ALTER TABLE public.league_config
  ADD COLUMN IF NOT EXISTS min_starting int NULL,
  ADD COLUMN IF NOT EXISTS max_subs     int NULL;

ALTER TABLE public.league_config
  ADD CONSTRAINT league_config_min_starting_check CHECK (min_starting IS NULL OR min_starting > 0);
ALTER TABLE public.league_config
  ADD CONSTRAINT league_config_max_subs_check CHECK (max_subs IS NULL OR max_subs >= 0);
