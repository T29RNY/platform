-- 602_publish_df_term_tier.sql
--
-- Publish DF Sports' live £80 "Term Membership" tier to public signup (operator decision,
-- 2026-07-17 — "DF included"). BUGS.md 2026-07-17: legacy tiers created before the
-- `self_signup` flag existed default to hidden (fail-closed), so DF's real £80 term tier
-- never appeared on its own join page. This flips ONLY DF's Term tier's `self_signup` flag
-- to true. PA's Junior/Adult tiers were already published by the demo-readiness pass.
--
-- ⚠️ Publishing a PAID tier makes it publicly joinable — a deliberate per-tier operator
-- choice (never a blanket UPDATE). Matched by stable venue_id + name (no hardcoded uuid,
-- Hard Rule: no generated ids in data migrations). Idempotent.
--
-- NOTE: DF has no `venue_landing` invite_links row yet, so DF still needs a public /q code
-- provisioned before a parent can reach this tier online — tracked separately.

UPDATE public.venue_membership_tiers
SET benefits    = jsonb_set(COALESCE(benefits, '{}'::jsonb), '{self_signup}', 'true'::jsonb),
    updated_at  = now()
WHERE venue_id = 'v_ffff5528a0'
  AND name = 'Term Membership'
  AND (benefits->>'self_signup') IS DISTINCT FROM 'true';
