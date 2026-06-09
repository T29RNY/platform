-- Migration 231 — Venue incident lifecycle (log + resolve from the venue dashboard).
--
-- Before this, incidents could only be CREATED via seed/SQL and only RESOLVED by HQ
-- (hq_resolve_incident, mig 171). The venue Operations "Open issues" panel surfaced them
-- read-only. This closes the loop on the venue side:
--   venue_log_incident(...)     — a venue admin reports an incident (flood, floodlight, etc.).
--   venue_resolve_incident(...) — a venue admin clears one of their own open incidents.
--
-- Schema: incidents.reported_by was uuid NOT NULL, but venue admins authenticate by TOKEN
-- (resolve_venue_caller → actor_type 'venue_admin', actor_ident 'venue_admin_token:<hash>'),
-- so auth.uid() is NULL for them. Drop NOT NULL (mirrors resolved_by, already nullable);
-- the actor identity is captured in audit_events.actor_identifier + the incident metadata.
--
-- notify_venue_change already whitelists 'incident_flagged' and 'incident_resolved'
-- (mig 181) — no change needed there.
--
-- Both write RPCs: SECDEF, search_path pinned, resolve_venue_caller auth, audited
-- (audit_events.team_id is NOT NULL → venue_id stands in, matching hq_resolve_incident),
-- notify_venue_change. Granted to anon + authenticated (venue admin uses the anon client + token).

-- ── schema: allow token-authenticated reporters (no auth.uid()) ────────────────
ALTER TABLE public.incidents ALTER COLUMN reported_by DROP NOT NULL;

-- ── venue_log_incident (WRITE) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_log_incident(
  p_venue_token text, p_description text, p_severity text, p_fixture_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_desc text := NULLIF(btrim(p_description), '');
  v_incident_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF v_desc IS NULL THEN
    RAISE EXCEPTION 'description_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_severity NOT IN ('info','warning','critical') THEN
    RAISE EXCEPTION 'invalid_severity' USING ERRCODE = 'P0001', DETAIL = p_severity;
  END IF;

  -- optional fixture link must belong to this venue (fixtures→competitions→seasons→leagues)
  IF p_fixture_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM fixtures f
      JOIN competitions c ON c.id = f.competition_id
      JOIN seasons s ON s.id = c.season_id
      JOIN leagues l ON l.id = s.league_id
      WHERE f.id = p_fixture_id AND l.venue_id = v_venue_id
    ) THEN
      RAISE EXCEPTION 'fixture_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO incidents (venue_id, fixture_id, reported_by, description, severity)
  VALUES (v_venue_id, p_fixture_id, auth.uid(), v_desc, p_severity)
  RETURNING id INTO v_incident_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'incident_flagged', 'incident', v_incident_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'severity', p_severity,
                             'fixture_id', p_fixture_id, 'description', v_desc));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_flagged');

  RETURN jsonb_build_object('ok', true, 'incident_id', v_incident_id, 'severity', p_severity);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_log_incident(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_log_incident(text, text, text, uuid) TO anon, authenticated;

-- ── venue_resolve_incident (WRITE) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_resolve_incident(
  p_venue_token text, p_incident_id uuid, p_resolution_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_note text := NULLIF(btrim(p_resolution_note), '');
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
REVOKE ALL ON FUNCTION public.venue_resolve_incident(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_resolve_incident(text, uuid, text) TO anon, authenticated;
