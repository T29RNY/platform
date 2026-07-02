-- Migration 467: Safeguarding module — Lead gate + flag/unflag write RPCs +
-- read-audit + neutral notify + flag-guarded Phase-1 write/resolve RPCs.
-- (Incident Triage Phase 2, PR #2. Depends on mig 466's schema.)
--
-- Design contract (SAFEGUARDING_MODULE_HANDOFF.md):
--   LD#3  any operator can FLAG; only Leads can SEE / ACTION (unflag).
--   LD#4  Lead gate = grant-only cap 'safeguarding_lead', role-INDEPENDENT.
--         MUST NOT route through _venue_has_cap (owner/manager default-pass
--         would auto-expose every owner+manager). Dedicated helper below.
--   LD#6/OQ#1  flagging atomically EVICTS the incident from the ops queue —
--         clears assigned_to / acknowledged_at / escalated_at / escalated_by /
--         escalation_reason. Prior STRUCTURAL state (never free-text content)
--         preserved in audit metadata.
--   LD#9  neutral, non-naming realtime reason ('incident_updated') — the shared
--         venue_live broadcast reaches non-leads, so 'safeguarding_*' would leak.
--   Existence-oracle-safe: a non-lead / flagged-row path returns the SAME
--         'incident_not_found_or_resolved' error as a genuinely missing row —
--         never a distinct "is safeguarding" error.

-- ===========================================================================
-- 1. Lead gate helper — grant-only, role-independent (LD#4).
--    Deliberately does NOT consult p_role: an owner/manager is NOT a Lead
--    unless explicitly granted 'safeguarding_lead'. actor_ident is the tagged
--    string from resolve_venue_caller; only the 'user_id:<uuid>' form can ever
--    match a real staff row → the shared venue_admin_token (empty caps, no
--    user identity) is structurally never a Lead (correct, by design).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._venue_is_safeguarding_lead(p_actor_ident text, p_venue_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_admins va
     WHERE ('user_id:' || va.user_id::text) = p_actor_ident
       AND va.venue_id  = p_venue_id
       AND va.status    = 'active'
       AND va.revoked_at IS NULL
       AND 'safeguarding_lead' = ANY(COALESCE(va.caps_grant, '{}'::text[]))
       AND NOT ('safeguarding_lead' = ANY(COALESCE(va.caps_deny, '{}'::text[])))
  );
$function$;

REVOKE ALL ON FUNCTION public._venue_is_safeguarding_lead(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._venue_is_safeguarding_lead(text, text) TO anon, authenticated;

-- ===========================================================================
-- 2. Extend notify_venue_change whitelist with the neutral reason (LD#9).
--    Reproduced verbatim from live (2026-07-01) with ONLY 'incident_updated'
--    added. The venue App.jsx subscriber refetches on any non-booking reason
--    (Hard Rule 10), so this generic reason makes a flagged row vanish from the
--    ops queue with no special client handling and without naming safeguarding.
-- ===========================================================================
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
    'incident_updated',
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

-- ===========================================================================
-- 3. venue_flag_safeguarding — ANY venue caller (LD#3). Atomic eviction (LD#6).
--    Idempotent (raises 'already_flagged'). Audits structural prior state only.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_flag_safeguarding(p_venue_token text, p_incident_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_prior    record;
  v_flagged  uuid;
  v_at       timestamptz;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  v_at := now();

  -- Capture prior STRUCTURAL state before eviction (never free-text content:
  -- no description, no escalation_reason go into audit metadata).
  SELECT assigned_to, acknowledged_at, escalated_at, escalated_by
    INTO v_prior
    FROM incidents
   WHERE id = p_incident_id AND venue_id = v_venue_id
     AND resolved_at IS NULL AND is_safeguarding_flagged IS NOT TRUE;

  UPDATE incidents
     SET is_safeguarding_flagged = true,
         safeguarding_flagged_by = v_caller.actor_ident,
         safeguarding_flagged_at = v_at,
         -- LD#6 atomic eviction from the ops queue:
         assigned_to             = NULL,
         acknowledged_at         = NULL,
         escalated_at            = NULL,
         escalated_by            = NULL,
         escalation_reason       = NULL
   WHERE id = p_incident_id AND venue_id = v_venue_id
     AND resolved_at IS NULL AND is_safeguarding_flagged IS NOT TRUE
   RETURNING id INTO v_flagged;

  IF v_flagged IS NULL THEN
    -- Idempotent: distinguish already-flagged from genuinely-not-found. Both are
    -- safe to reveal to the flagger (any caller can flag, so no existence oracle).
    IF EXISTS (SELECT 1 FROM incidents
                WHERE id = p_incident_id AND venue_id = v_venue_id
                  AND is_safeguarding_flagged IS TRUE) THEN
      RAISE EXCEPTION 'already_flagged' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'incident_not_found_or_resolved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'incident_safeguarding_flagged', 'incident', p_incident_id::text,
          jsonb_build_object('venue_id', v_venue_id,
                             'prior_assigned_to', v_prior.assigned_to,
                             'prior_acknowledged', (v_prior.acknowledged_at IS NOT NULL),
                             'prior_escalated', (v_prior.escalated_at IS NOT NULL)));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_updated');

  RETURN jsonb_build_object('ok', true, 'incident_id', p_incident_id, 'flagged_at', v_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_flag_safeguarding(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_flag_safeguarding(text, uuid) TO anon, authenticated;

-- ===========================================================================
-- 4. venue_unflag_safeguarding — Lead-only (LD#3). Re-enters the ops queue with
--    ops fields blank (they were cleared on flag). Audits.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_unflag_safeguarding(p_venue_token text, p_incident_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_unflagged uuid;
  v_at       timestamptz;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_is_safeguarding_lead(v_caller.actor_ident, v_venue_id) THEN
    RAISE EXCEPTION 'not_a_safeguarding_lead' USING ERRCODE = 'P0001';
  END IF;
  v_at := now();

  UPDATE incidents
     SET is_safeguarding_flagged = false,
         safeguarding_flagged_by = NULL,
         safeguarding_flagged_at = NULL
   WHERE id = p_incident_id AND venue_id = v_venue_id
     AND resolved_at IS NULL AND is_safeguarding_flagged IS TRUE
   RETURNING id INTO v_unflagged;

  IF v_unflagged IS NULL THEN
    RAISE EXCEPTION 'incident_not_found_or_resolved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'incident_safeguarding_unflagged', 'incident', p_incident_id::text,
          jsonb_build_object('venue_id', v_venue_id));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_updated');

  RETURN jsonb_build_object('ok', true, 'incident_id', p_incident_id, 'unflagged_at', v_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_unflag_safeguarding(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_unflag_safeguarding(text, uuid) TO anon, authenticated;

-- ===========================================================================
-- 5. Gate the FOUR Phase-1 write/resolve RPCs so a non-lead cannot triage /
--    escalate / resolve a FLAGGED row. Each gets ONLY the flag predicate added
--    to its target WHERE → a flagged row yields a 0-row UPDATE → the SAME
--    not-found error, never a distinct "is safeguarding" error (existence-
--    oracle-safe). Bodies reproduced verbatim from live (2026-07-01); the added
--    predicate is the sole change in each.
-- ===========================================================================

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
     AND is_safeguarding_flagged IS NOT TRUE
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
     AND is_safeguarding_flagged IS NOT TRUE
   RETURNING id INTO v_escalated;

  IF v_escalated IS NULL THEN
    -- The already_escalated probe also excludes flagged rows so it can never
    -- act as an existence oracle for a hidden safeguarding incident.
    IF EXISTS (SELECT 1 FROM incidents
                WHERE id = p_incident_id AND venue_id = v_venue_id AND escalated_at IS NOT NULL
                  AND is_safeguarding_flagged IS NOT TRUE) THEN
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
     AND is_safeguarding_flagged IS NOT TRUE
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
  WHERE i.id = p_incident_id AND v.company_id = p_company_id AND i.resolved_at IS NULL
    AND i.is_safeguarding_flagged IS NOT TRUE;
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
