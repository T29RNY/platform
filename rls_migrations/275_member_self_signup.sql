-- 275_member_self_signup.sql
--
-- Phase 5 (continuation) — MEMBER SELF-SIGNUP on the existing /q/ venue rail.
-- A prospective member scans the venue's `/q/<code>` (action `venue_landing`,
-- mig 248) and taps "Join as a member". `member_self_signup(code, …)` creates a
-- `venue_customers` row in a new `pending` state; venue ops then approves/rejects
-- via `venue_approve_customer` (gated `manage_memberships`). Mirrors the existing
-- team-registration pending→approve pattern (competition_teams) but on the person
-- entity. No new invite action / no change to `resolve_invite_link` — rides the
-- already-shipped venue_landing code.

-- 1. New 'pending' status on the person entity.
ALTER TABLE public.venue_customers DROP CONSTRAINT IF EXISTS venue_customers_status_check;
ALTER TABLE public.venue_customers ADD CONSTRAINT venue_customers_status_check
  CHECK (status IN ('pending','active','archived','erased'));

-- 2. notify whitelist: add the two self-signup reasons.
CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
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
    'booking_requested','booking_confirmed','booking_declined','booking_cancelled','booking_superseded',
    'payment_recorded','payment_voided','charge_updated',
    'customer_self_signup','customer_approved'
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

-- 3. member_self_signup — PUBLIC (anon). Resolves the venue from the /q venue
--    code, creates a pending person. Idempotent on (venue,email): an existing
--    non-erased person is returned as already_registered (never duplicated, never
--    silently re-set). first_name is the only hard requirement.
CREATE OR REPLACE FUNCTION public.member_self_signup(
  p_code              text,
  p_first_name        text,
  p_last_name         text DEFAULT NULL,
  p_email             text DEFAULT NULL,
  p_phone             text DEFAULT NULL,
  p_consent_marketing boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_link     record;
  v_venue_id text;
  v_first    text := NULLIF(btrim(p_first_name), '');
  v_email    text := NULLIF(lower(btrim(p_email)), '');
  v_phone    text := NULLIF(btrim(p_phone), '');
  v_existing record;
  v_id       uuid;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  SELECT entity_id, entity_type, action, active, expires_at, max_uses, use_count
    INTO v_link
    FROM public.invite_links
   WHERE code = btrim(p_code);
  IF NOT FOUND OR v_link.entity_type <> 'venue' OR v_link.action <> 'venue_landing' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF NOT v_link.active
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at < now())
     OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  v_venue_id := v_link.entity_id;

  IF v_first IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'first_name_required');
  END IF;

  -- Idempotent on email: an existing non-erased person is returned, not duplicated.
  IF v_email IS NOT NULL THEN
    SELECT id, status INTO v_existing FROM public.venue_customers
     WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased'
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'already_registered', true, 'status', v_existing.status);
    END IF;
  END IF;

  INSERT INTO public.venue_customers
    (venue_id, first_name, last_name, email, phone, status,
     consent_marketing, consent_at)
  VALUES
    (v_venue_id, v_first, NULLIF(btrim(p_last_name), ''), v_email, v_phone, 'pending',
     COALESCE(p_consent_marketing, false),
     CASE WHEN COALESCE(p_consent_marketing, false) THEN now() ELSE NULL END)
  RETURNING id INTO v_id;

  UPDATE public.invite_links SET use_count = use_count + 1 WHERE code = btrim(p_code);

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), 'system', 'self_signup:' || btrim(p_code),
          'venue_customer_self_signup', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'via', 'qr_venue_landing',
                             'has_email', v_email IS NOT NULL, 'has_phone', v_phone IS NOT NULL,
                             'consent_marketing', COALESCE(p_consent_marketing, false)));

  PERFORM public.notify_venue_change(v_venue_id, 'customer_self_signup');

  RETURN jsonb_build_object('ok', true, 'already_registered', false, 'status', 'pending');
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean) TO anon, authenticated;

-- 4. venue_approve_customer — WRITE, gated manage_memberships. pending → active
--    (approve) or pending → archived (reject). Only acts on pending rows.
CREATE OR REPLACE FUNCTION public.venue_approve_customer(
  p_venue_token text,
  p_customer_id uuid,
  p_approve     boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_status   text;
  v_new      text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM public.venue_customers
   WHERE id = p_customer_id AND venue_id = v_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_status);
  END IF;

  v_new := CASE WHEN COALESCE(p_approve, true) THEN 'active' ELSE 'archived' END;
  UPDATE public.venue_customers SET status = v_new, updated_at = now()
   WHERE id = p_customer_id AND venue_id = v_venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          CASE WHEN v_new = 'active' THEN 'venue_customer_approved' ELSE 'venue_customer_rejected' END,
          'venue_customer', p_customer_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'new_status', v_new));

  PERFORM public.notify_venue_change(v_venue_id, 'customer_approved');

  RETURN jsonb_build_object('ok', true, 'status', v_new);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_approve_customer(text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_approve_customer(text,uuid,boolean) TO anon, authenticated;
