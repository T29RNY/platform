-- 605_pa_membership_prices.sql
-- PA membership prices (operator: £480 / season for Junior + Adult, 2026-07-17).
-- PA's Junior/Adult tiers had NO venue_tier_prices row, so public signup showed them with
-- no price. Set them as a SEASON membership at £480/season (pricing_model='season' — the
-- vmt_pricing_model_check allows recurring|season; matches DF's Term tier model). Prices
-- remain fully editable by the operator via the venue app Memberships → TierModal. Matched
-- by venue_id + name (no hardcoded generated ids); idempotent (skips if an active price exists).

UPDATE public.venue_membership_tiers
SET pricing_model = 'season', updated_at = now()
WHERE venue_id = 'pa_peugeot' AND name IN ('Junior Membership', 'Adult Membership');

INSERT INTO public.venue_tier_prices (tier_id, period, price_pence, price_type, active)
SELECT t.id, 'season', 48000, 'standard', true
FROM public.venue_membership_tiers t
WHERE t.venue_id = 'pa_peugeot'
  AND t.name IN ('Junior Membership', 'Adult Membership')
  AND NOT EXISTS (SELECT 1 FROM public.venue_tier_prices tp WHERE tp.tier_id = t.id AND tp.active);
