-- Migration 285 — Reframe venue_memberships: add club/member/pricing hooks
-- Membership V2 Phase 1: additive ALTERs only — all new columns nullable or defaulted.
-- Existing v1 rows remain valid: customer_id still present, new columns NULL until backfill (mig 288).
-- No existing code breaks. No column removed or renamed.

ALTER TABLE public.venue_memberships
  -- Club ownership hook: which club issued this membership
  ADD COLUMN IF NOT EXISTS club_id           text    REFERENCES public.clubs(id),
  -- Person layer: who the membership belongs to (member) and who pays (payer/parent)
  ADD COLUMN IF NOT EXISTS member_profile_id uuid    REFERENCES public.member_profiles(id),
  ADD COLUMN IF NOT EXISTS payer_profile_id  uuid    REFERENCES public.member_profiles(id),
  -- Pricing model discriminator for future pro-rata/season vs recurring
  ADD COLUMN IF NOT EXISTS pricing_model     text    NOT NULL DEFAULT 'term'
                           CHECK (pricing_model IN ('recurring','term')),
  -- Cohort hook: age-group / squad membership (Phase 10 attendance, Phase 12 staff scoping)
  ADD COLUMN IF NOT EXISTS cohort_id         uuid    REFERENCES public.club_cohorts(id);
