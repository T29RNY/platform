-- 172_hq_dashboard_config.sql
-- League Mode Phase 6 Cycle 6.3 — composable HQ dashboard (Layer A).
--
-- Per-admin saved dashboard layout. NULL = use the default preset. Shape:
--   { "preset": "operations"|"commercial"|"performance"|null,
--     "cards": ["overview","venue_comparison","top_scorers","discipline","incidents","billing"] }
-- The card keys map to datasets returned by hq_get_analytics (mig 173). Stored per
-- (company_id, user_id) on company_admins so each admin customises their own view; the
-- Phase 7 AI layer will later compose over the same card registry. Additive + nullable.

ALTER TABLE public.company_admins ADD COLUMN IF NOT EXISTS dashboard_config jsonb NULL;
