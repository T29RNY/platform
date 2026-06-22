-- down for 381: drop the info column. To revert get_tournament_public's added fields,
-- re-apply the prior definition (migration 321 lineage). Additive return fields are
-- backward-compatible, so leaving the function in place is safe.
ALTER TABLE public.tournament_events DROP COLUMN IF EXISTS info;
