-- Down for mig 191 — drop the Phase 11.4a group-stage columns.
ALTER TABLE public.competitions     DROP COLUMN IF EXISTS config;
ALTER TABLE public.fixtures         DROP COLUMN IF EXISTS group_label;
ALTER TABLE public.competition_teams DROP COLUMN IF EXISTS seed;
ALTER TABLE public.competition_teams DROP COLUMN IF EXISTS group_label;
