-- 169_venues_region.sql
-- League Mode Phase 6 (HQ Dashboard) Cycle 6.1 — regional_admin scoping.
--
-- company_admins.region (mig 055) lets an HQ admin be scoped to a region, but venues
-- had no region to match against, so regional filtering was impossible. Add a nullable
-- region label to venues; hq_get_company_state / hq_get_venue_detail / hq_resolve_incident
-- (mig 171) filter venues to caller.region when the caller's role is 'regional_admin'.
--
-- Additive + nullable: no existing RPC or JS reads venues.region (new this cycle), so
-- nothing to fix elsewhere (schema-sync swept).

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS region text NULL;
