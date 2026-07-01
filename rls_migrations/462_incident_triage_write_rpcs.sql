-- 462_incident_triage_write_rpcs.sql
-- Incident Triage — PR #2: venue-owned triage + escalation write RPCs.
-- Depends on mig 461 (triage columns). Both RPCs SECDEF, search_path locked,
-- venue-scoped (cross-venue write blocked), audited (Hard Rule 9), notify (Hard Rule 10).

-- ---------------------------------------------------------------------------
-- 1. notify_venue_change whitelist: add the two new realtime reasons.
--    Reproduced verbatim from live + only the two array entries added.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    'venue_created','venue_updated','season_created','season_updated',
    'fixtures_generated','fixtures_cascaded','fixture_scheduled','fixture_status_changed',
    'fixture_postponed','fixture_voided','fixture_walkover','fixture_forfeit',
    'ref_assigned','ref_changed','ref_no_show','ref_added','ref_updated',
    'pitch_assigned','pitch_added','pitch_updated','pitch_closed',
    'team_registration_pending','team_approved','team_rejected','team_withdrew','team_expelled',
    'incident_flagged',
    'match_started','match_event_recorded','match_result_saved',
    'result_corrected',
    'incident_resolved',
    'incident_triaged','incident_escalated',
    'booking_requested','booking_confirmed','booking_declined','booking_cancelled','booking_superseded',
    'payment_recorded','payment_voided','charge_updated',
    'customer_self_signup','customer_approved',
    'pitch_bump_proposed','pitch_bump_resolved'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_venue_change: unknown reason "%" for venue "%"', p_reason, p_venue_id;
  END IF;
  SELECT live_channel_key INTO v_channel_key FROM venues WHERE id = p_venue_id;
  IF v_channel_key IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    jsonb_build_object('type','venue_state_changed','reason',p_reason,'at',extract(epoch from now())),
    'broadcast', 'venue_live:' || v_channel_key, false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. venue_triage_incident — set any provided triage field + optional ack.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_triage_incident(
  p_venue_token text,
  p_incident_id uuid,
  p_category    text    DEFAULT NULL,
  p_priority    text    DEFAULT NULL,
  p_assigned_to uuid    DEFAULT NULL,
  p_acknowledge boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  record;
  v_venue_id text;
  v_cat text := NULLIF(btrim(p_category), '');
  v_pri text := NULLIF(btrim(p_priority), '');
  v_updated uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF v_cat IS NOT NULL AND v_cat NOT IN
     ('facility','equipment','safety','medical','conduct','security','weather','safeguarding','other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'P0001', DETAIL = v_cat;
  END IF;
  IF v_pri IS NOT NULL AND v_pri NOT IN ('low','normal','high','urgent') THEN
    RAISE EXCEPTION 'invalid_priority' USING ERRCODE = 'P0001', DETAIL = v_pri;
  END IF;

  -- Assignee must be an active admin of THIS venue (no hard FK; validated here).
  IF p_assigned_to IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.venue_admins va
       WHERE va.user_id  = p_assigned_to
         AND va.venue_id = v_venue_id
         AND va.status   = 'active'
         AND va.revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'assignee_not_venue_admin' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- At least one triage field must be provided.
  IF v_cat IS NULL AND v_pri IS NULL AND p_assigned_to IS NULL
     AND COALESCE(p_acknowledge, false) = false THEN
    RAISE EXCEPTION 'no_triage_fields' USING ERRCODE = 'P0001';
  END IF;

  UPDATE incidents
     SET category        = COALESCE(v_cat, category),
         priority        = COALESCE(v_pri, priority),
         assigned_to     = COALESCE(p_assigned_to, assigned_to),
         acknowledged_at = CASE WHEN COALESCE(p_acknowledge, false)
                                THEN COALESCE(acknowledged_at, now())
                                ELSE acknowledged_at END
   WHERE id = p_incident_id AND venue_id = v_venue_id AND resolved_at IS NULL
   RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'incident_not_found_or_resolved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'incident_triaged', 'incident', p_incident_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'category', v_cat, 'priority', v_pri,
                             'assigned_to', p_assigned_to, 'acknowledged', COALESCE(p_acknowledge, false)));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_triaged');

  RETURN jsonb_build_object('ok', true, 'incident_id', p_incident_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. venue_escalate_incident — push an open incident up to HQ. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_escalate_incident(
  p_venue_token text,
  p_incident_id uuid,
  p_reason      text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_reason   text := NULLIF(btrim(p_reason), '');
  v_escalated uuid;
  v_at        timestamptz;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  v_at := now();

  UPDATE incidents
     SET escalated_at      = v_at,
         escalated_by      = v_caller.actor_ident,
         escalation_reason = v_reason
   WHERE id = p_incident_id AND venue_id = v_venue_id
     AND resolved_at IS NULL AND escalated_at IS NULL
   RETURNING id INTO v_escalated;

  IF v_escalated IS NULL THEN
    -- Distinguish already-escalated (idempotency signal) from not-found/resolved.
    IF EXISTS (SELECT 1 FROM incidents
                WHERE id = p_incident_id AND venue_id = v_venue_id AND escalated_at IS NOT NULL) THEN
      RAISE EXCEPTION 'already_escalated' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'incident_not_found_or_resolved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'incident_escalated', 'incident', p_incident_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'reason', v_reason));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_escalated');

  RETURN jsonb_build_object('ok', true, 'incident_id', p_incident_id, 'escalated_at', v_at);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Grants (parity with mig 231: venue token flow serves anon + authenticated).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.venue_triage_incident(text, uuid, text, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_triage_incident(text, uuid, text, text, uuid, boolean) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.venue_escalate_incident(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_escalate_incident(text, uuid, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
