-- Down for migration 180 — Venue Payments Ledger V1 schema.
-- Drops the two tables (payments cascade) + the four fee/link columns.
-- NOTE: this also removes the demo seed (it lived only in venue_charges/payments).

DROP TABLE IF EXISTS public.venue_payments;
DROP TABLE IF EXISTS public.venue_charges;

ALTER TABLE public.league_config DROP COLUMN IF EXISTS fixture_fee_pence;
ALTER TABLE public.league_config DROP COLUMN IF EXISTS fixture_fee_payer;
ALTER TABLE public.playing_areas DROP COLUMN IF EXISTS default_fee_pence;
ALTER TABLE public.venues        DROP COLUMN IF EXISTS payment_link;
