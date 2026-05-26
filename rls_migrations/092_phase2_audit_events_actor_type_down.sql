-- 092_phase2_audit_events_actor_type_down.sql
--
-- Restores the pre-Phase-2 whitelist. Any rows already carrying a
-- Phase 2 actor_type value would block this revert; the down-mig
-- maps them to 'service_role' first.

UPDATE public.audit_events
  SET actor_type = 'service_role'
  WHERE actor_type IN ('venue_admin','league_admin','platform_admin');

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;

ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_actor_type_check
    CHECK (actor_type IN (
      'team_admin', 'vice_captain', 'club_admin', 'super_admin',
      'player', 'service_role', 'system'
    ));
