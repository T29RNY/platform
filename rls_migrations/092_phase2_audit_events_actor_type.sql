-- 092_phase2_audit_events_actor_type.sql
--
-- Cycle 2.3 in-flight hotfix. The audit_events.actor_type CHECK
-- (mig 003) was authored before Phase 2 personas existed. Every Phase
-- 2 RPC inserts audit rows with actor_type ∈ {venue_admin,
-- league_admin, platform_admin} resolved via resolve_venue_caller /
-- resolve_league_caller — none of which are in the original whitelist.
--
-- Caught during Cycle 2.3 venue_create_season smoke. Latent across
-- every Phase 2 mutating RPC.
--
-- Expand the whitelist additively. No data migration needed: existing
-- rows all carry pre-Phase-2 values which remain in the allowed set.

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;

ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_actor_type_check
    CHECK (actor_type IN (
      -- Original (mig 003)
      'team_admin', 'vice_captain', 'club_admin', 'super_admin',
      'player', 'service_role', 'system',
      -- Phase 2 additions
      'venue_admin', 'league_admin', 'platform_admin'
    ));
