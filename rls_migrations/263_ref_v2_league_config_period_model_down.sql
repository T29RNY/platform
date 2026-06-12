-- Down for migration 263 — Ref V2 league_config period model.
-- Drops the new columns; the legacy has_halves/half_duration_mins fields are untouched.
ALTER TABLE public.league_config
  DROP COLUMN IF EXISTS period_names,
  DROP COLUMN IF EXISTS period_length_mins,
  DROP COLUMN IF EXISTS num_periods;
