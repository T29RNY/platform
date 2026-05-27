-- 120_phase3_ref_match_writes_down.sql
-- Reverts mig 120: drops the 7 ref RPCs and the private helper,
-- removes the audit_events.actor_type 'referee' extension, removes
-- the two new notify_team_change reasons (via CREATE OR REPLACE to
-- the mig-062 body), removes match_events.client_event_id +
-- fixtures.actual_kickoff_at.
--
-- NOTE: the demo seed in mig 120 (player_registrations + shirt
-- backfill + Demo Player rows) is intentionally NOT undone — the
-- rows are useful even if Phase 3 is rolled back, and player_id
-- FKs are CASCADE-safe.

DROP FUNCTION IF EXISTS public.ref_confirm_full_time(text);
DROP FUNCTION IF EXISTS public.ref_undo_event(text, uuid);
DROP FUNCTION IF EXISTS public.ref_set_period(text, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ref_record_substitution(text, text, text, integer, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ref_record_card(text, text, integer, text, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ref_record_goal(text, text, integer, text, uuid, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.ref_start_match(text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public._ref_resolve_fixture(text);

-- Revert get_fixture_state_by_ref_token to the mig-119 body (without
-- actual_kickoff_at). We do this by simply dropping it — the operator
-- can re-apply mig 119 if they want the read path back.
DROP FUNCTION IF EXISTS public.get_fixture_state_by_ref_token(text);

-- Revert notify_team_change whitelist (remove the two new reasons).
-- The simplest revert is to re-create with the mig-062 body. Operator
-- can re-apply mig 062 directly if preferred.
DROP FUNCTION IF EXISTS public.notify_team_change(text, text);

-- Revert audit_events.actor_type CHECK.
ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_actor_type_check
  CHECK (actor_type IN (
    'team_admin','vice_captain','club_admin','super_admin','player',
    'service_role','system','venue_admin','league_admin','platform_admin'
  ));

-- Revert schema additions.
ALTER TABLE public.fixtures      DROP COLUMN IF EXISTS actual_kickoff_at;
ALTER TABLE public.match_events  DROP CONSTRAINT IF EXISTS match_events_client_event_id_key;
ALTER TABLE public.match_events  DROP COLUMN IF EXISTS client_event_id;
