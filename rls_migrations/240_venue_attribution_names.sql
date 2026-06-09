-- 240_venue_attribution_names.sql
--
-- Venue staff logins — Phase 5 (attribution payoff). The login work made every
-- venue action record WHO did it (incidents.reported_by / resolved_by =
-- auth.uid(); audit_events.actor_identifier = 'user_id:<uuid>'). This surfaces
-- the actual PERSON's name where the UI previously showed the venue name as a
-- placeholder (session-77 incident reporter line).
--
-- Read-only change — no write paths touched, so no ephemeral-verify (rollback)
-- needed. Adds:
--   1. _venue_actor_name(uuid) — resolves a user_id to a display name
--      (Google full_name / name metadata, else email). NULL-safe.
--   2. venue_get_state.open_incidents gains `reported_by_name` via that helper
--      (injected programmatically — venue_get_state is large; we read its body
--      verbatim and add one field rather than hand-transcribe it). The existing
--      `reported_by` uuid is preserved. Frontend falls back to the venue name
--      when the name is null (legacy/token-reported incidents).

CREATE OR REPLACE FUNCTION public._venue_actor_name(p_uid uuid)
 RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    NULLIF(btrim(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(u.raw_user_meta_data->>'name'), ''),
    u.email
  )
  FROM auth.users u
  WHERE u.id = p_uid;
$$;
REVOKE ALL ON FUNCTION public._venue_actor_name(uuid) FROM PUBLIC;

DO $mig$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc
   WHERE proname = 'venue_get_state' AND pronamespace = 'public'::regnamespace;
  v_def := pg_get_functiondef(v_oid);

  IF position('reported_by_name' IN v_def) > 0 THEN RETURN; END IF;  -- idempotent

  IF position($q$'reported_by', i.reported_by, 'created_at', i.created_at)$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'venue_get_state incidents anchor not found';
  END IF;

  v_def := replace(
    v_def,
    $q$'reported_by', i.reported_by, 'created_at', i.created_at)$q$,
    $q$'reported_by', i.reported_by, 'reported_by_name', public._venue_actor_name(i.reported_by), 'created_at', i.created_at)$q$
  );
  EXECUTE v_def;
END $mig$;
