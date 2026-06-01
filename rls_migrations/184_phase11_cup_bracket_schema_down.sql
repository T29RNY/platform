-- Down for migration 184 — Phase 11 cup bracket schema.
-- Drops the fixtures linkage column then the cup_ties table. cup_rounds is left in
-- place (it pre-existed this migration as empty groundwork from mig 055).

ALTER TABLE public.fixtures DROP COLUMN IF EXISTS cup_tie_id;
DROP TABLE IF EXISTS public.cup_ties;
