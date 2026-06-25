-- 430 — DEMO SEED: give Charlie Carter a membership + fees so the Guardian Membership
-- screen (and the desktop venue finance views) populate. Additive + idempotent
-- (ON CONFLICT DO NOTHING / guarded). Reuses existing demo rows:
--   child  Charlie Carter  = member_profiles 0d000000-0000-4000-8000-000000000013
--   payer  Sam Carter      = member_profiles 0d000000-0000-4000-8000-000000000012 (accepted guardian)
--   club   club_demo  ·  venue demo_venue  ·  Junior tier 0a000000-...-0003
--
-- Seeds: 1 active Junior membership (Sam pays), 2 venue_charges (one PAID with a matching
-- venue_payment, one DUE/unpaid with no pay_url → "Pay now" mints a hosted invoice on demand).

-- ── 1. Membership ──
INSERT INTO public.venue_memberships
  (id, member_profile_id, payer_profile_id, club_id, venue_id, tier_id, period, amount_pence, status, renews_at)
VALUES (
  'a0000000-0000-4000-8000-000000000430'::uuid,
  '0d000000-0000-4000-8000-000000000013'::uuid,   -- Charlie
  '0d000000-0000-4000-8000-000000000012'::uuid,   -- Sam (payer)
  'club_demo', 'demo_venue',
  '0a000000-0000-4000-8000-000000000003'::uuid,   -- Junior tier
  'monthly', 1800, 'active', (now() + interval '1 month')::date
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. PAID charge (last month) + its payment ──
INSERT INTO public.venue_charges
  (id, venue_id, source_type, source_id, amount_due_pence, status, due_date)
VALUES (
  'b0000000-0000-4000-8000-000000000430'::uuid, 'demo_venue', 'membership',
  'a0000000-0000-4000-8000-000000000430:' || (now() - interval '1 month')::date::text, 1800, 'paid', (now() - interval '1 month')::date
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_payments (id, charge_id, amount_pence, method, kind)
VALUES (
  'c0000000-0000-4000-8000-000000000430'::uuid,
  'b0000000-0000-4000-8000-000000000430'::uuid, 1800, 'cash', 'payment'
)
ON CONFLICT (id) DO NOTHING;

-- ── 3. DUE charge (this month) — no pay_url, so Pay-now mints a hosted invoice ──
INSERT INTO public.venue_charges
  (id, venue_id, source_type, source_id, amount_due_pence, status, due_date)
VALUES (
  'b0000000-0000-4000-8000-000000000431'::uuid, 'demo_venue', 'membership',
  'a0000000-0000-4000-8000-000000000430:' || now()::date::text, 1800, 'unpaid', (now() + interval '5 days')::date
)
ON CONFLICT (id) DO NOTHING;
