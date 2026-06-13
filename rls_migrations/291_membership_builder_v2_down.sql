-- Down: mig 291 membership builder v2
DROP FUNCTION IF EXISTS public.venue_update_club_settings(text, text, boolean, jsonb);
DROP FUNCTION IF EXISTS public.venue_create_membership_tier(text, text, jsonb, jsonb, text, text, date, date);
DROP FUNCTION IF EXISTS public.venue_update_membership_tier(text, uuid, text, jsonb, boolean, jsonb, text, text, date, date);
DROP FUNCTION IF EXISTS public.venue_list_clubs(text);

ALTER TABLE public.venue_membership_tiers
  DROP CONSTRAINT IF EXISTS vmt_audience_check,
  DROP CONSTRAINT IF EXISTS vmt_pricing_model_check,
  DROP COLUMN IF EXISTS audience,
  DROP COLUMN IF EXISTS pricing_model,
  DROP COLUMN IF EXISTS season_start,
  DROP COLUMN IF EXISTS season_end;

ALTER TABLE public.venue_tier_prices
  DROP CONSTRAINT IF EXISTS vtp_price_type_check,
  DROP CONSTRAINT IF EXISTS venue_tier_prices_tier_id_period_price_type_key,
  DROP CONSTRAINT IF EXISTS venue_tier_prices_period_check,
  DROP COLUMN IF EXISTS price_type;

ALTER TABLE public.venue_tier_prices
  ADD CONSTRAINT venue_tier_prices_period_check CHECK (period IN ('monthly','quarterly','annual')),
  ADD CONSTRAINT venue_tier_prices_tier_id_period_key UNIQUE (tier_id, period);
