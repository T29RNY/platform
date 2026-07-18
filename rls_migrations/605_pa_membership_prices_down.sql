-- 605_pa_membership_prices_down.sql — reverses 605.
DELETE FROM public.venue_tier_prices tp
USING public.venue_membership_tiers t
WHERE tp.tier_id = t.id
  AND t.venue_id = 'pa_peugeot' AND t.name IN ('Junior Membership', 'Adult Membership')
  AND tp.period = 'season' AND tp.price_pence = 48000 AND tp.price_type = 'standard';

UPDATE public.venue_membership_tiers
SET pricing_model = 'recurring'
WHERE venue_id = 'pa_peugeot' AND name IN ('Junior Membership', 'Adult Membership');
