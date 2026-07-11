-- 543_book_and_pay_context.sql — book-and-pay flow (on-device walk).
-- The guardian "Book · £X" button must take the family THROUGH payment; completing payment IS
-- the booking. To drive one shared pay sheet (card via Stripe / bank via the club's payment_link /
-- cash at the club) from BOTH surfaces (Sessions camp sheet + Membership → Extra classes), the book
-- RPC now returns the payment context of the charge it just created, and no longer hard-blocks a
-- prepay class when Stripe isn't connected — cash/bank are always offered instead of a dead wall.
--
-- ADDITIVE to guardian_book_class_session's return shape (existing consumers keep working):
--   charge_id        — the venue_charge just created for this booking (NULL if waived / package-paid / waitlist)
--   amount_pence     — that charge's amount_due_pence (0 if nothing to pay)
--   stripe_available — the club's Stripe is connected (→ show "Pay by card")
--   manual_pay_url   — the club's venues.payment_link (→ show "Bank transfer / pay online"); NULL if none
-- Behaviour change: the prepay-without-Stripe `payment_method_unavailable` early-return is REMOVED.
-- A prepay class now books (pending) and the client offers cash/bank; the club settles it with the
-- venue_record_payment they already use. auth / guardian / capacity / suspension logic UNCHANGED.

CREATE OR REPLACE FUNCTION public.guardian_book_class_session(p_session_id uuid, p_for_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_caller       public.member_profiles;
  v_target       uuid;
  v_target_ns    int;
  v_sess         public.venue_class_sessions;
  v_members_only boolean;
  v_threshold    int;
  v_occupied     int;
  v_existing     public.venue_class_bookings;
  v_status       text;
  v_wpos         int;
  v_booking_id   uuid;
  v_connected    boolean;
  v_charge_id    uuid;
  v_amount       int;
  v_manual_url   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_caller FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  IF p_for_profile_id IS NOT NULL AND p_for_profile_id <> v_caller.id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE guardian_profile_id = v_caller.id
        AND child_profile_id    = p_for_profile_id
        AND invite_state        = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_target := p_for_profile_id;
  ELSE
    v_target := v_caller.id;
  END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RAISE EXCEPTION 'session_not_bookable' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_sess.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT members_only INTO v_members_only FROM public.venue_class_types WHERE id = v_sess.class_type_id;
  IF COALESCE(v_members_only, true) THEN
    IF NOT public._member_entitled_at_venue(v_target, v_sess.venue_id) THEN
      RAISE EXCEPTION 'membership_required' USING ERRCODE='P0001';
    END IF;
  END IF;

  SELECT no_show_suspension_threshold INTO v_threshold FROM public.venues WHERE id = v_sess.venue_id;
  SELECT no_show_count INTO v_target_ns FROM public.member_profiles WHERE id = v_target;
  IF v_threshold IS NOT NULL AND COALESCE(v_target_ns,0) >= v_threshold THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suspended', 'no_show_count', v_target_ns);
  END IF;

  -- Stripe availability is now informational only (drives the "Pay by card" option). A prepay
  -- class no longer hard-blocks when Stripe is dormant — the client offers cash/bank instead.
  SELECT EXISTS (SELECT 1 FROM public.venue_integrations
                  WHERE venue_id = v_sess.venue_id AND provider = 'stripe' AND status = 'connected')
    INTO v_connected;

  SELECT * INTO v_existing FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_target;
  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed','waitlist','offered') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_booked',
                              'booking_id', v_existing.id, 'status', v_existing.status);
  END IF;

  SELECT count(*) INTO v_occupied FROM public.venue_class_bookings
   WHERE session_id = p_session_id
     AND (status = 'confirmed'
          OR (status = 'offered' AND offer_expires_at > now()));
  IF v_sess.capacity > 0 AND v_occupied < v_sess.capacity THEN
    v_status := 'confirmed'; v_wpos := NULL;
  ELSE
    v_status := 'waitlist';
    SELECT COALESCE(max(waitlist_position), 0) + 1 INTO v_wpos
      FROM public.venue_class_bookings WHERE session_id = p_session_id AND status = 'waitlist';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.venue_class_bookings
       SET status = v_status, waitlist_position = v_wpos, booked_at = now(),
           cancelled_at = NULL, offer_expires_at = NULL,
           payment_status = 'pending', payment_method = 'not_yet'
     WHERE id = v_existing.id
     RETURNING id INTO v_booking_id;
  ELSE
    INSERT INTO public.venue_class_bookings (session_id, member_profile_id, status, waitlist_position)
    VALUES (p_session_id, v_target, v_status, v_wpos)
    RETURNING id INTO v_booking_id;
  END IF;

  IF v_status = 'confirmed' THEN
    PERFORM public._apply_class_booking_charge(v_booking_id);
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings WHERE id = v_booking_id;

  -- Payment context of the charge the booking just created (if any). Waived / package-paid /
  -- waitlist bookings have no charge → charge_id NULL, amount 0 (client shows "nothing to pay").
  SELECT id, amount_due_pence INTO v_charge_id, v_amount
    FROM public.venue_charges
   WHERE source_type = 'class' AND source_id = v_booking_id::text AND status <> 'refunded'
   ORDER BY created_at DESC LIMIT 1;
  SELECT payment_link INTO v_manual_url FROM public.venues WHERE id = v_sess.venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_sess.venue_id, v_uid, 'player', 'guardian_class_booked', 'venue_class_booking', v_booking_id::text,
          jsonb_build_object('session_id', p_session_id, 'status', v_status,
                             'member_profile_id', v_target,
                             'booked_by_profile_id', v_caller.id,
                             'for_child', (v_target <> v_caller.id),
                             'waitlist_position', v_wpos));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', v_status,
                            'payment_status', v_existing.payment_status,
                            'payment_method', v_existing.payment_method,
                            'waitlist_position', v_wpos,
                            'charge_id', v_charge_id,
                            'amount_pence', COALESCE(v_amount, 0),
                            'stripe_available', COALESCE(v_connected, false),
                            'manual_pay_url', v_manual_url);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_book_class_session(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.guardian_book_class_session(uuid, uuid) TO authenticated;
