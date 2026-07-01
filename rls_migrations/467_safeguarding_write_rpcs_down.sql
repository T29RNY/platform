-- Down migration for 467_safeguarding_write_rpcs.sql
-- Drops the new safeguarding write RPCs + helper, reverts the four Phase-1
-- write/resolve RPCs to their pre-467 bodies (verbatim from live 2026-07-01),
-- and removes 'incident_updated' from notify_venue_change.

DROP FUNCTION IF EXISTS public.venue_flag_safeguarding(text, uuid);
DROP FUNCTION IF EXISTS public.venue_unflag_safeguarding(text, uuid);
DROP FUNCTION IF EXISTS public._venue_is_safeguarding_lead(text, text);

-- Revert notify_venue_change (remove 'incident_updated').
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

-- Revert venue_triage_incident (remove flag guard).
CREATE OR REPLACE FUNCTION public.venue_triage_incident(p_venue_token text, p_incident_id uuid, p_category text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid, p_acknowledge boolean DEFAULT false)
 RETURNS jsonb
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

-- Revert venue_escalate_incident (remove flag guard).
CREATE OR REPLACE FUNCTION public.venue_escalate_incident(p_venue_token text, p_incident_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
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

-- Revert venue_resolve_incident (remove flag guard).
CREATE OR REPLACE FUNCTION public.venue_resolve_incident(p_venue_token text, p_incident_id uuid, p_outcome text DEFAULT NULL::text, p_resolution_note text DEFAULT NULL::text)
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

-- Revert hq_resolve_incident (remove flag guard).
CREATE OR REPLACE FUNCTION public.hq_resolve_incident(p_company_id text, p_incident_id uuid, p_resolution_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_uid uuid := auth.uid();
  v_venue_id text; v_venue_region text; v_resolved timestamptz;
  v_note text := NULLIF(btrim(p_resolution_note), '');
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_role = 'analyst' THEN RAISE EXCEPTION 'read_only_role'; END IF;

  SELECT v.id, v.region INTO v_venue_id, v_venue_region
  FROM incidents i JOIN venues v ON v.id = i.venue_id
  WHERE i.id = p_incident_id AND v.company_id = p_company_id AND i.resolved_at IS NULL;
  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'incident_not_found_or_resolved'; END IF;
  IF v_role = 'regional_admin' AND v_venue_region IS DISTINCT FROM v_region THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE incidents SET resolved_at = now(), resolved_by = v_uid, resolution_note = v_note
   WHERE id = p_incident_id RETURNING resolved_at INTO v_resolved;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, v_uid, v_actor, 'user_id:' || COALESCE(v_uid::text, '?'), 'incident_resolved', 'incident', p_incident_id::text,
          jsonb_build_object('company_id', p_company_id, 'venue_id', v_venue_id, 'note', v_note));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_resolved');
  RETURN jsonb_build_object('ok', true, 'incident_id', p_incident_id, 'resolved_at', v_resolved);
END;
$function$;
