-- 437_incident_outcome_down.sql — revert mig 437.
-- Restores the 3-arg venue_resolve_incident (mig 231 shape) and drops the
-- outcome column + its check constraint.

DROP FUNCTION IF EXISTS public.venue_resolve_incident(text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.venue_resolve_incident(
  p_venue_token text,
  p_incident_id uuid,
  p_resolution_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_note     text := NULLIF(btrim(p_resolution_note), '');
  v_resolved timestamptz;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  UPDATE incidents
     SET resolved_at = now(), resolved_by = auth.uid(), resolution_note = v_note
   WHERE id = p_incident_id AND venue_id = v_venue_id AND resolved_at IS NULL
   RETURNING resolved_at INTO v_resolved;

  IF v_resolved IS NULL THEN
    RAISE EXCEPTION 'incident_not_found_or_resolved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'incident_resolved', 'incident', p_incident_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'note', v_note));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_resolved');

  RETURN jsonb_build_object('ok', true, 'incident_id', p_incident_id, 'resolved_at', v_resolved);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_resolve_incident(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_resolve_incident(text, uuid, text) TO anon, authenticated;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_outcome_chk;
ALTER TABLE incidents DROP COLUMN IF EXISTS outcome;
