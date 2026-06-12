-- Migration 263 — Ref V2: modernise league_config with a general period model.
-- Cycle "RefSix-killer" / apps/ref/REF_V2_BUILD_PLAN.md, schema change M3.
--
-- league_config is Phase-0 work that only ever modelled "halves: yes/no", which cannot
-- express a single 60-min game or 4×15 quarters. We add a general period model and
-- BACK-FILL it from the legacy fields so existing leagues are unchanged in behaviour.
--
--   num_periods        — 1 (single), 2 (halves), 4 (quarters), … open-ended.
--   period_length_mins — minutes per period; the ref clock counts toward this and prompts
--                        the period change at the mark.
--   period_names       — labels, e.g. {1H,2H} or {Q1,Q2,Q3,Q4}; events/UI use these.
--
-- The legacy has_halves / half_duration_mins / match_duration_mins columns are LEFT IN
-- PLACE for back-compat; the new fields supersede them and existing consumers migrate over
-- time. sin_bin_mins (already present) remains the sin-bin length.
--
-- Resolution order at read time (handled in get_fixture_state_by_ref_token, later migration):
--   league_config default → competition.config override → fixtures.format_override.

ALTER TABLE public.league_config
  ADD COLUMN IF NOT EXISTS num_periods        integer CHECK (num_periods IS NULL OR num_periods > 0),
  ADD COLUMN IF NOT EXISTS period_length_mins integer CHECK (period_length_mins IS NULL OR period_length_mins > 0),
  ADD COLUMN IF NOT EXISTS period_names       text[];

-- Back-fill the new model from the legacy has_halves shape (idempotent — only fills NULLs).
UPDATE public.league_config
   SET num_periods = CASE WHEN has_halves THEN 2 ELSE 1 END
 WHERE num_periods IS NULL;

UPDATE public.league_config
   SET period_length_mins = CASE WHEN has_halves
                                 THEN COALESCE(half_duration_mins, NULLIF(match_duration_mins,0) / 2)
                                 ELSE match_duration_mins END
 WHERE period_length_mins IS NULL;

UPDATE public.league_config
   SET period_names = CASE WHEN num_periods = 2 THEN ARRAY['1H','2H']
                          WHEN num_periods = 4 THEN ARRAY['Q1','Q2','Q3','Q4']
                          ELSE ARRAY['1H'] END
 WHERE period_names IS NULL;
