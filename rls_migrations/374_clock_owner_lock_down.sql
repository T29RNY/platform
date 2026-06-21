-- 374 DOWN: revert Phase 0d single-writer clock-owner lock.
-- Drops the four new ref_*_clock RPCs + the validator + the owner-json helper, and removes the
-- clock_owner_* columns. ref_set_clock / ref_set_added_time / get_fixture_state_by_ref_token keep
-- their additive changes (extra team-channel notifies + the clock_owner key are harmless to leave —
-- the key resolves to NULL once the helper is gone). If a full revert of those three is required,
-- re-apply their pre-374 bodies from migration 372's neighbourhood / git history.

DROP FUNCTION IF EXISTS public.validate_casual_ref_activations(text);
DROP FUNCTION IF EXISTS public.ref_check_clock_owner(text, text);
DROP FUNCTION IF EXISTS public.ref_release_clock(text, text);
DROP FUNCTION IF EXISTS public.ref_heartbeat_clock(text, text);
DROP FUNCTION IF EXISTS public.ref_claim_clock(text, text, text, boolean);

-- get_fixture_state_by_ref_token references _ref_clock_owner_json — drop the column-dependent key by
-- restoring the helper to a NULL-returning stub BEFORE dropping columns, so the function still parses.
CREATE OR REPLACE FUNCTION public._ref_clock_owner_json(v public.fixtures)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $function$ SELECT NULL::jsonb $function$;

ALTER TABLE public.fixtures
  DROP COLUMN IF EXISTS clock_owner_expires_at,
  DROP COLUMN IF EXISTS clock_owner_claimed_at,
  DROP COLUMN IF EXISTS clock_owner_kind,
  DROP COLUMN IF EXISTS clock_owner_id;

DROP FUNCTION IF EXISTS public._ref_clock_owner_json(public.fixtures);

SELECT pg_notify('pgrst', 'reload schema');
