-- 437_incident_outcome.sql
-- Operator "Tonight" (mobile) — structured incident-resolution outcome.
-- Adds a constrained `outcome` column to incidents and extends
-- venue_resolve_incident with a p_outcome arg. No notify path (deferred to the
-- Broadcast-composer cycle, where the fan-out target actually exists). Auth and
-- grants unchanged from mig 231 (anon token path + authenticated venue_id path,
-- both resolved by resolve_venue_caller).

-- 1. Structured outcome column (nullable: existing rows + free-text resolutions = NULL)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_outcome_chk;
ALTER TABLE incidents ADD CONSTRAINT incidents_outcome_chk
  CHECK (outcome IS NULL OR outcome IN ('fixed','safe','contractor','nofault'));

-- 2. Replace the 3-arg signature. Param-count change → DROP first (CREATE OR
--    REPLACE would leave the old 3-arg overload, causing "could not choose best
--    candidate function" at runtime).
DROP FUNCTION IF EXISTS public.venue_resolve_incident(text, uuid, text);

CREATE OR REPLACE FUNCTION public.venue_resolve_incident(
  p_venue_token text,
  p_incident_id uuid,
  p_outcome text DEFAULT NULL,
  p_resolution_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_outcome  text := NULLIF(btrim(p_outcome), '');
  v_note     text := NULLIF(btrim(p_resolution_note), '');
  v_resolved timestamptz;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF v_outcome IS NOT NULL AND v_outcome NOT IN ('fixed','safe','contractor','nofault') THEN
    RAISE EXCEPTION 'invalid_outcome' USING ERRCODE = 'P0001', DETAIL = v_outcome;
  END IF;

  UPDATE incidents
     SET resolved_at = now(), resolved_by = auth.uid(),
         outcome = v_outcome, resolution_note = v_note
   WHERE id = p_incident_id AND venue_id = v_venue_id AND resolved_at IS NULL
   RETURNING resolved_at INTO v_resolved;

  IF v_resolved IS NULL THEN
    RAISE EXCEPTION 'incident_not_found_or_resolved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'incident_resolved', 'incident', p_incident_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'outcome', v_outcome, 'note', v_note));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_resolved');

  RETURN jsonb_build_object('ok', true, 'incident_id', p_incident_id,
                            'resolved_at', v_resolved, 'outcome', v_outcome);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_resolve_incident(text, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_resolve_incident(text, uuid, text, text) TO anon, authenticated;
