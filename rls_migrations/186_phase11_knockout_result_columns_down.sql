-- Down for migration 186 — drop the knockout decider columns.
ALTER TABLE public.fixtures
  DROP COLUMN IF EXISTS aet_home_score,
  DROP COLUMN IF EXISTS aet_away_score,
  DROP COLUMN IF EXISTS pens_home_score,
  DROP COLUMN IF EXISTS pens_away_score,
  DROP COLUMN IF EXISTS ko_winner_id,
  DROP COLUMN IF EXISTS decided_by;
