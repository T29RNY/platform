-- 613_notification_drain_sent_at_down.sql
-- Reverts 613: restores the exact pre-613 live bodies of the 10 functions — i.e. the
-- notification_log queue-inserts WITHOUT `channel, sent_at` (the buggy form where the row
-- is born already-"sent" and never drains). Signatures / grants unchanged.

BEGIN;

-- ── 1. member_request_room_hire ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_request_room_hire(p_space_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_purpose text, p_attendee_count integer DEFAULT NULL::integer, p_equipment_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile public.member_profiles;
  v_space   public.venue_spaces;
  v_open    int;
  v_hire_id uuid;
  v_eid     uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  IF p_purpose IS NULL OR length(btrim(p_purpose)) = 0 THEN
    RAISE EXCEPTION 'purpose_required' USING ERRCODE='P0001';
  END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'bad_time_range' USING ERRCODE='P0001'; END IF;
  IF p_starts_at <= now() THEN RAISE EXCEPTION 'starts_in_past' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_space FROM public.venue_spaces WHERE id = p_space_id;
  IF NOT FOUND OR NOT v_space.is_active THEN RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_feature_enabled(v_space.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  -- throttle: at most 5 open ('requested') hires for this member at this space
  SELECT count(*) INTO v_open FROM public.venue_room_hires
   WHERE space_id = p_space_id AND member_profile_id = v_profile.id AND status = 'requested';
  IF v_open >= 5 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_requests'); END IF;

  IF NOT public._space_is_available(p_space_id, p_starts_at, p_ends_at) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'space_unavailable');
  END IF;

  INSERT INTO public.venue_room_hires
    (venue_id, space_id, booker_type, member_profile_id, booker_name, booker_email, booker_phone,
     starts_at, ends_at, purpose, attendee_count, status)
  VALUES
    (v_space.venue_id, p_space_id, 'member', v_profile.id,
     btrim(COALESCE(v_profile.first_name,'') || ' ' || COALESCE(v_profile.last_name,'')),
     v_profile.email, v_profile.phone,
     p_starts_at, p_ends_at, btrim(p_purpose), p_attendee_count, 'requested')
  RETURNING id INTO v_hire_id;

  IF p_equipment_ids IS NOT NULL THEN
    FOREACH v_eid IN ARRAY p_equipment_ids LOOP
      IF EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = v_eid AND e.venue_id = v_space.venue_id) THEN
        INSERT INTO public.equipment_bookings
          (equipment_id, venue_id, room_hire_id, qty, start_at, end_at, status, booked_by_name)
        VALUES
          (v_eid, v_space.venue_id, v_hire_id, 1, p_starts_at, p_ends_at, 'requested',
           btrim(COALESCE(v_profile.first_name,'') || ' ' || COALESCE(v_profile.last_name,'')));
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_space.venue_id, v_profile.id::text, 'room_hire_requested', v_hire_id::text, v_profile.email, now(),
         jsonb_build_object('venue_name', vn.name, 'space_name', v_space.name,
                            'starts_at', p_starts_at, 'purpose', btrim(p_purpose))
    FROM public.venues vn WHERE vn.id = v_space.venue_id AND v_profile.email IS NOT NULL;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_space.venue_id, v_uid, 'player', 'room_hire_requested', 'venue_room_hire', v_hire_id::text,
          jsonb_build_object('space_id', p_space_id, 'member_profile_id', v_profile.id,
                             'starts_at', p_starts_at, 'ends_at', p_ends_at));

  RETURN jsonb_build_object('ok', true, 'hire_id', v_hire_id, 'status', 'requested');
END;
$function$;
REVOKE ALL ON FUNCTION public.member_request_room_hire(uuid, timestamptz, timestamptz, text, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_request_room_hire(uuid, timestamptz, timestamptz, text, integer, uuid[]) TO authenticated;

-- ── 2. public_enquire_room_hire ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.public_enquire_room_hire(p_space_id uuid, p_name text, p_email text, p_phone text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_purpose text, p_attendee_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_space   public.venue_spaces;
  v_recent  int;
  v_hire_id uuid;
BEGIN
  SELECT * INTO v_space FROM public.venue_spaces WHERE id = p_space_id;
  IF NOT FOUND OR NOT v_space.is_active THEN RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT v_space.is_enquiry_only THEN RAISE EXCEPTION 'not_enquiry_only' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_feature_enabled(v_space.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  IF p_email IS NULL OR position('@' IN p_email) = 0 OR length(p_email) > 160 THEN
    RAISE EXCEPTION 'bad_email' USING ERRCODE='P0001';
  END IF;
  IF p_purpose IS NULL OR length(btrim(p_purpose)) = 0 THEN RAISE EXCEPTION 'purpose_required' USING ERRCODE='P0001'; END IF;
  IF length(btrim(p_name)) > 120 OR length(btrim(p_purpose)) > 500
     OR (p_phone IS NOT NULL AND length(p_phone) > 40) THEN
    RAISE EXCEPTION 'input_too_long' USING ERRCODE='P0001';
  END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'bad_time_range' USING ERRCODE='P0001'; END IF;

  SELECT count(*) INTO v_recent FROM public.venue_room_hires
   WHERE space_id = p_space_id AND lower(booker_email) = lower(btrim(p_email))
     AND created_at > now() - INTERVAL '10 minutes';
  IF v_recent >= 3 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_requests'); END IF;

  INSERT INTO public.venue_room_hires
    (venue_id, space_id, booker_type, booker_name, booker_email, booker_phone,
     starts_at, ends_at, purpose, attendee_count, status)
  VALUES
    (v_space.venue_id, p_space_id, 'non_member', btrim(p_name), btrim(p_email),
     NULLIF(btrim(COALESCE(p_phone,'')), ''),
     p_starts_at, p_ends_at, btrim(p_purpose), p_attendee_count, 'requested')
  RETURNING id INTO v_hire_id;

  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_space.venue_id, NULL, 'room_hire_requested', v_hire_id::text, btrim(p_email), now(),
         jsonb_build_object('venue_name', vn.name, 'space_name', v_space.name,
                            'starts_at', p_starts_at, 'purpose', btrim(p_purpose))
    FROM public.venues vn WHERE vn.id = v_space.venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_space.venue_id, NULL, 'system', 'public_enquiry', 'room_hire_enquired', 'venue_room_hire', v_hire_id::text,
          jsonb_build_object('space_id', p_space_id, 'email', btrim(p_email), 'starts_at', p_starts_at));

  RETURN jsonb_build_object('ok', true, 'hire_id', v_hire_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.public_enquire_room_hire(uuid, text, text, text, timestamptz, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_enquire_room_hire(uuid, text, text, text, timestamptz, timestamptz, text, integer) TO anon, authenticated;

-- ── 3. venue_confirm_room_hire ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_confirm_room_hire(p_venue_token text, p_hire_id uuid, p_price_pence integer, p_deposit_pence integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_hire      public.venue_room_hires;
  v_charge_id uuid;
  v_recipient text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_hire FROM public.venue_room_hires WHERE id = p_hire_id;
  IF NOT FOUND OR v_hire.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'hire_not_found' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_feature_enabled(v_hire.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_hire.status <> 'requested' THEN RAISE EXCEPTION 'not_confirmable' USING ERRCODE='P0001'; END IF;
  IF p_price_pence IS NULL OR p_price_pence < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF p_deposit_pence IS NOT NULL AND p_deposit_pence < 0 THEN RAISE EXCEPTION 'bad_deposit' USING ERRCODE='P0001'; END IF;

  UPDATE public.venue_room_hires
     SET status = 'confirmed', price_pence = p_price_pence, deposit_pence = p_deposit_pence
   WHERE id = p_hire_id;

  IF p_price_pence > 0
     AND NOT EXISTS (SELECT 1 FROM public.venue_charges
                      WHERE source_type = 'room_hire' AND source_id = p_hire_id::text AND status <> 'refunded') THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_hire.venue_id, 'room_hire', p_hire_id::text, p_price_pence, 'unpaid', v_hire.starts_at::date)
    RETURNING id INTO v_charge_id;
  END IF;

  UPDATE public.equipment_bookings SET status = 'confirmed'
   WHERE room_hire_id = p_hire_id AND status = 'requested';

  v_recipient := COALESCE(v_hire.booker_email,
                          (SELECT email FROM public.member_profiles WHERE id = v_hire.member_profile_id));
  IF v_recipient IS NOT NULL THEN
    INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
    SELECT v_hire.venue_id, v_hire.member_profile_id::text, 'room_hire_confirmed', p_hire_id::text, v_recipient, now(),
           jsonb_build_object('venue_name', vn.name, 'space_name', sp.name, 'starts_at', v_hire.starts_at,
                              'purpose', v_hire.purpose, 'price_pence', p_price_pence, 'deposit_pence', p_deposit_pence)
      FROM public.venues vn, public.venue_spaces sp
     WHERE vn.id = v_hire.venue_id AND sp.id = v_hire.space_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_hire.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'room_hire_confirmed', 'venue_room_hire', p_hire_id::text,
          jsonb_build_object('price_pence', p_price_pence, 'deposit_pence', p_deposit_pence));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'charge_id', v_charge_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_confirm_room_hire(text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_confirm_room_hire(text, uuid, integer, integer) TO anon, authenticated;

-- ── 4. venue_cancel_room_hire ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_cancel_room_hire(p_venue_token text, p_hire_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_hire      public.venue_room_hires;
  v_refunded  int := 0;
  v_recipient text;
  v_new_dep   text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_hire FROM public.venue_room_hires WHERE id = p_hire_id;
  IF NOT FOUND OR v_hire.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'hire_not_found' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_feature_enabled(v_hire.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_hire.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  v_new_dep := CASE WHEN v_hire.deposit_status = 'held' THEN 'returned' ELSE v_hire.deposit_status END;

  UPDATE public.venue_room_hires
     SET status = 'cancelled', deposit_status = v_new_dep
   WHERE id = p_hire_id;

  UPDATE public.venue_charges SET status = 'refunded'
   WHERE source_type = 'room_hire' AND source_id = p_hire_id::text AND status <> 'refunded';
  GET DIAGNOSTICS v_refunded = ROW_COUNT;

  UPDATE public.equipment_bookings SET status = 'cancelled'
   WHERE room_hire_id = p_hire_id AND status IN ('requested','confirmed');

  v_recipient := COALESCE(v_hire.booker_email,
                          (SELECT email FROM public.member_profiles WHERE id = v_hire.member_profile_id));
  IF v_recipient IS NOT NULL THEN
    INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
    SELECT v_hire.venue_id, v_hire.member_profile_id::text, 'room_hire_cancelled', p_hire_id::text, v_recipient, now(),
           jsonb_build_object('venue_name', vn.name, 'space_name', sp.name, 'starts_at', v_hire.starts_at,
                              'purpose', v_hire.purpose, 'reason', COALESCE(p_reason,''))
      FROM public.venues vn, public.venue_spaces sp
     WHERE vn.id = v_hire.venue_id AND sp.id = v_hire.space_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_hire.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'room_hire_cancelled', 'venue_room_hire', p_hire_id::text,
          jsonb_build_object('reason', COALESCE(p_reason,''), 'refunded', v_refunded, 'deposit_status', v_new_dep));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'refunded', v_refunded, 'deposit_status', v_new_dep);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_cancel_room_hire(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_room_hire(text, uuid, text) TO anon, authenticated;

-- ── 5. venue_create_room_hire ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_room_hire(p_venue_token text, p_space_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_purpose text, p_price_pence integer DEFAULT 0, p_booker_name text DEFAULT NULL::text, p_booker_email text DEFAULT NULL::text, p_booker_phone text DEFAULT NULL::text, p_deposit_pence integer DEFAULT NULL::integer, p_attendee_count integer DEFAULT NULL::integer, p_member_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_space     public.venue_spaces;
  v_profile   public.member_profiles;
  v_type      text;
  v_name      text;
  v_email     text;
  v_phone     text;
  v_hire_id   uuid;
  v_charge_id uuid;
  v_recipient text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;

  IF p_purpose IS NULL OR length(btrim(p_purpose)) = 0 THEN
    RAISE EXCEPTION 'purpose_required' USING ERRCODE='P0001';
  END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'bad_time_range' USING ERRCODE='P0001'; END IF;
  IF p_price_pence IS NULL OR p_price_pence < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF p_deposit_pence IS NOT NULL AND p_deposit_pence < 0 THEN RAISE EXCEPTION 'bad_deposit' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_space FROM public.venue_spaces WHERE id = p_space_id FOR UPDATE;
  IF NOT FOUND OR NOT v_space.is_active THEN RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001'; END IF;
  IF v_space.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'space_not_in_venue' USING ERRCODE='P0001'; END IF;
  IF NOT public._space_is_available(p_space_id, p_starts_at, p_ends_at) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'space_unavailable');
  END IF;

  IF p_member_profile_id IS NOT NULL THEN
    SELECT * INTO v_profile FROM public.member_profiles WHERE id = p_member_profile_id;
    IF v_profile.id IS NULL THEN RAISE EXCEPTION 'member_not_found' USING ERRCODE='P0001'; END IF;
    v_type  := 'member';
    v_name  := COALESCE(NULLIF(btrim(COALESCE(p_booker_name,'')), ''),
                        btrim(COALESCE(v_profile.first_name,'') || ' ' || COALESCE(v_profile.last_name,'')));
    v_email := COALESCE(NULLIF(btrim(COALESCE(p_booker_email,'')), ''), v_profile.email);
    v_phone := COALESCE(NULLIF(btrim(COALESCE(p_booker_phone,'')), ''), v_profile.phone);
  ELSE
    IF p_booker_name IS NULL OR length(btrim(p_booker_name)) = 0 THEN
      RAISE EXCEPTION 'booker_required' USING ERRCODE='P0001';
    END IF;
    v_type  := 'non_member';
    v_name  := btrim(p_booker_name);
    v_email := NULLIF(btrim(COALESCE(p_booker_email,'')), '');
    v_phone := NULLIF(btrim(COALESCE(p_booker_phone,'')), '');
  END IF;

  INSERT INTO public.venue_room_hires
    (venue_id, space_id, booker_type, member_profile_id, booker_name, booker_email, booker_phone,
     starts_at, ends_at, purpose, attendee_count, status, price_pence, deposit_pence)
  VALUES
    (v_space.venue_id, p_space_id, v_type, p_member_profile_id, v_name, v_email, v_phone,
     p_starts_at, p_ends_at, btrim(p_purpose), p_attendee_count, 'confirmed',
     p_price_pence, p_deposit_pence)
  RETURNING id INTO v_hire_id;

  IF p_price_pence > 0 THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_space.venue_id, 'room_hire', v_hire_id::text, p_price_pence, 'unpaid', p_starts_at::date)
    RETURNING id INTO v_charge_id;
  END IF;

  v_recipient := v_email;
  IF v_recipient IS NOT NULL THEN
    INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
    SELECT v_space.venue_id, p_member_profile_id::text, 'room_hire_confirmed', v_hire_id::text, v_recipient, now(),
           jsonb_build_object('venue_name', vn.name, 'space_name', v_space.name, 'starts_at', p_starts_at,
                              'purpose', btrim(p_purpose), 'price_pence', p_price_pence, 'deposit_pence', p_deposit_pence)
      FROM public.venues vn WHERE vn.id = v_space.venue_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_space.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'room_hire_created_by_operator', 'venue_room_hire', v_hire_id::text,
          jsonb_build_object('space_id', p_space_id, 'booker_type', v_type, 'member_profile_id', p_member_profile_id,
                             'starts_at', p_starts_at, 'ends_at', p_ends_at, 'price_pence', p_price_pence));

  RETURN jsonb_build_object('ok', true, 'hire_id', v_hire_id, 'charge_id', v_charge_id, 'status', 'confirmed');
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_create_room_hire(text, uuid, timestamptz, timestamptz, text, integer, text, text, text, integer, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_room_hire(text, uuid, timestamptz, timestamptz, text, integer, text, text, text, integer, integer, uuid) TO anon, authenticated;

-- ── 6. venue_cancel_class_session ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_cancel_class_session(p_venue_token text, p_session_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_sess public.venue_class_sessions; v_refunded int := 0; v_notified int := 0; v_credits int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'already', true, 'session_id', p_session_id); END IF;
  UPDATE public.venue_class_sessions SET status='cancelled', cancellation_reason=p_reason WHERE id=p_session_id;
  UPDATE public.venue_charges c SET status='refunded'
   WHERE c.source_type='class' AND c.status<>'refunded'
     AND c.source_id IN (SELECT b.id::text FROM public.venue_class_bookings b WHERE b.session_id = p_session_id);
  GET DIAGNOSTICS v_refunded = ROW_COUNT;
  UPDATE public.venue_member_package_balances bal SET sessions_remaining = sessions_remaining + 1
    FROM public.venue_class_bookings b
   WHERE b.session_id = p_session_id AND b.status IN ('confirmed','waitlist','offered') AND b.package_balance_id = bal.id;
  GET DIAGNOSTICS v_credits = ROW_COUNT;
  UPDATE public.venue_class_bookings b SET status='cancelled', cancelled_at=now(), package_balance_id=NULL
   WHERE b.session_id = p_session_id AND b.status IN ('confirmed','waitlist','offered');
  GET DIAGNOSTICS v_notified = ROW_COUNT;
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_caller.venue_id, b.member_profile_id::text, 'class_cancelled', p_session_id::text, mp.email, now(),
         jsonb_build_object('reason', p_reason)
    FROM public.venue_class_bookings b JOIN public.member_profiles mp ON mp.id = b.member_profile_id
   WHERE b.session_id = p_session_id AND b.status = 'cancelled';
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_session_cancelled', 'venue_class_session', p_session_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason, 'refunded', v_refunded,
                             'notified', v_notified, 'credits_restored', v_credits));
  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'refunded', v_refunded, 'notified', v_notified);
END; $function$;
REVOKE ALL ON FUNCTION public.venue_cancel_class_session(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_class_session(text, uuid, text) TO anon, authenticated;

-- ── 7. venue_cancel_class_series ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_cancel_class_series(p_venue_token text, p_series_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_cancelled int := 0; v_refunded int := 0; v_credits int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT ct.venue_id INTO v_venue_id FROM public.venue_class_series s
    JOIN public.venue_class_types ct ON ct.id = s.class_type_id WHERE s.id = p_series_id;
  IF v_venue_id IS NULL OR v_venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE='P0001'; END IF;
  UPDATE public.venue_charges c SET status='refunded'
   WHERE c.source_type='class' AND c.status<>'refunded'
     AND c.source_id IN (SELECT b.id::text FROM public.venue_class_bookings b
       JOIN public.venue_class_sessions cs ON cs.id = b.session_id
       WHERE cs.series_id = p_series_id AND cs.status='scheduled' AND cs.starts_at>now());
  GET DIAGNOSTICS v_refunded = ROW_COUNT;
  UPDATE public.venue_member_package_balances bal SET sessions_remaining = sessions_remaining + 1
    FROM public.venue_class_bookings b JOIN public.venue_class_sessions cs ON cs.id = b.session_id
   WHERE cs.series_id = p_series_id AND cs.status='scheduled' AND cs.starts_at>now()
     AND b.status IN ('confirmed','waitlist','offered') AND b.package_balance_id = bal.id;
  GET DIAGNOSTICS v_credits = ROW_COUNT;
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_caller.venue_id, b.member_profile_id::text, 'class_cancelled', cs.id::text, mp.email, now(),
         jsonb_build_object('reason', p_reason, 'series_id', p_series_id)
    FROM public.venue_class_bookings b JOIN public.venue_class_sessions cs ON cs.id = b.session_id
    JOIN public.member_profiles mp ON mp.id = b.member_profile_id
   WHERE cs.series_id = p_series_id AND cs.status='scheduled' AND cs.starts_at>now() AND b.status IN ('confirmed','waitlist','offered');
  UPDATE public.venue_class_bookings b SET status='cancelled', cancelled_at=now(), package_balance_id=NULL
   WHERE b.status IN ('confirmed','waitlist','offered')
     AND b.session_id IN (SELECT cs.id FROM public.venue_class_sessions cs
       WHERE cs.series_id = p_series_id AND cs.status='scheduled' AND cs.starts_at>now());
  UPDATE public.venue_class_sessions SET status='cancelled', cancellation_reason=p_reason
   WHERE series_id = p_series_id AND status='scheduled' AND starts_at>now();
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  UPDATE public.venue_class_series SET is_active = false WHERE id = p_series_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_series_cancelled', 'venue_class_series', p_series_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason, 'sessions_cancelled', v_cancelled,
                             'refunded', v_refunded, 'credits_restored', v_credits));
  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id, 'sessions_cancelled', v_cancelled, 'refunded', v_refunded);
END; $function$;
REVOKE ALL ON FUNCTION public.venue_cancel_class_series(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_class_series(text, uuid, text) TO anon, authenticated;

-- ── 8. venue_reassign_class_instructor ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_reassign_class_instructor(p_venue_token text, p_session_id uuid, p_new_instructor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_sess public.venue_class_sessions;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' THEN RAISE EXCEPTION 'session_not_scheduled' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_admins WHERE id = p_new_instructor_id AND venue_id = v_caller.venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'instructor_not_found' USING ERRCODE='P0001';
  END IF;
  UPDATE public.venue_class_sessions SET instructor_id = p_new_instructor_id WHERE id = p_session_id;
  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    EXECUTE format($q$
      INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for)
      SELECT %L, b.member_profile_id::text, 'class_instructor_changed', %L, mp.email, now()
        FROM public.venue_class_bookings b
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.session_id = %L AND b.status = 'confirmed'
    $q$, v_caller.venue_id, p_session_id::text, p_session_id);
  END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_instructor_reassigned', 'venue_class_session', p_session_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'from', v_sess.instructor_id, 'to', p_new_instructor_id));
  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'instructor_id', p_new_instructor_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_reassign_class_instructor(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_reassign_class_instructor(text, uuid, uuid) TO anon, authenticated;

-- ── 9. member_cancel_class_booking ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_cancel_class_booking(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid; v_bk public.venue_class_bookings; v_sess public.venue_class_sessions;
  v_ct public.venue_class_types; v_venue_id text; v_was text; v_refunded int := 0; v_offered uuid;
  v_frees_seat boolean; v_credit_restored boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_bk FROM public.venue_class_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_bk.member_profile_id <> v_profile_id THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE='P0001'; END IF;
  IF v_bk.status NOT IN ('confirmed','waitlist','offered') THEN RAISE EXCEPTION 'not_cancellable' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = v_bk.session_id;
  SELECT * INTO v_ct   FROM public.venue_class_types    WHERE id = v_sess.class_type_id;
  v_venue_id := v_sess.venue_id; v_was := v_bk.status;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_was = 'confirmed' AND now() > v_sess.starts_at - (v_ct.cancellation_cutoff_hours * INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'cutoff_passed' USING ERRCODE='P0001';
  END IF;
  v_frees_seat := (v_was = 'confirmed') OR (v_was = 'offered' AND v_bk.offer_expires_at IS NOT NULL AND v_bk.offer_expires_at > now());
  IF v_bk.package_balance_id IS NOT NULL THEN
    UPDATE public.venue_member_package_balances SET sessions_remaining = sessions_remaining + 1 WHERE id = v_bk.package_balance_id;
    v_credit_restored := true;
  END IF;
  UPDATE public.venue_class_bookings SET status='cancelled', cancelled_at=now(), waitlist_position=NULL, offer_expires_at=NULL, package_balance_id=NULL WHERE id=p_booking_id;
  UPDATE public.venue_charges SET status='refunded' WHERE source_type='class' AND source_id=p_booking_id::text AND status<>'refunded';
  GET DIAGNOSTICS v_refunded = ROW_COUNT;
  IF v_frees_seat AND v_sess.status='scheduled' AND v_sess.starts_at>now() THEN
    v_offered := public._offer_next_waitlist_spot(v_bk.session_id);
  END IF;
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_venue_id, v_profile_id::text, 'class_booking_cancelled', p_booking_id::text, mp.email, now(),
         jsonb_build_object('session_id', v_bk.session_id) FROM public.member_profiles mp WHERE mp.id = v_profile_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, v_uid, 'player', 'member_class_cancelled', 'venue_class_booking', p_booking_id::text,
          jsonb_build_object('session_id', v_bk.session_id, 'was', v_was, 'refunded', v_refunded,
                             'offered', v_offered, 'credit_restored', v_credit_restored));
  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'refunded', v_refunded,
                            'offered', (v_offered IS NOT NULL), 'credit_restored', v_credit_restored);
END; $function$;
REVOKE ALL ON FUNCTION public.member_cancel_class_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_cancel_class_booking(uuid) TO authenticated;

-- ── 10. _offer_next_waitlist_spot ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._offer_next_waitlist_spot(p_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sess     public.venue_class_sessions;
  v_window   int;
  v_occupied int;
  v_next     uuid;
BEGIN
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_occupied FROM public.venue_class_bookings
   WHERE session_id = p_session_id
     AND (status = 'confirmed'
          OR (status = 'offered' AND offer_expires_at > now()));
  IF v_sess.capacity <= 0 OR v_occupied >= v_sess.capacity THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_next FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND status = 'waitlist'
   ORDER BY waitlist_position ASC NULLS LAST, booked_at ASC
   LIMIT 1;
  IF v_next IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(class_claim_window_minutes, 30) INTO v_window
    FROM public.venues WHERE id = v_sess.venue_id;
  v_window := COALESCE(v_window, 30);

  UPDATE public.venue_class_bookings
     SET status = 'offered', offer_expires_at = now() + (v_window * INTERVAL '1 minute')
   WHERE id = v_next;

  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_sess.venue_id, b.member_profile_id::text, 'class_spot_offered', b.id::text, mp.email, now(),
         jsonb_build_object('session_id', p_session_id,
                            'offer_expires_at', (now() + (v_window * INTERVAL '1 minute')))
    FROM public.venue_class_bookings b
    JOIN public.member_profiles mp ON mp.id = b.member_profile_id
   WHERE b.id = v_next;

  RETURN v_next;
END;
$function$;
REVOKE ALL ON FUNCTION public._offer_next_waitlist_spot(uuid) FROM PUBLIC, anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
