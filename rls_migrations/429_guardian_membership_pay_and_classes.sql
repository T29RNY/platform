-- 429 — Guardian Membership (Phase 1 screen 3): per-child money + book extra class for child
--
-- WHY: The Guardian Membership screen (apps/inorout /hub, GuardianMembership.jsx) needs
-- three things, all landing in the SAME tables the laptop venue dashboard already reads
-- (venue_memberships, venue_charges, venue_class_bookings) — no parallel system:
--   1. Per-CHILD membership + fees. get_my_money already returns the guardian's whole
--      ledger (self + children), but rows carried only a who_for NAME, so the client
--      could not reliably filter to the active child. Add member_profile_id to every
--      membership + charge row. ADDITIVE return-shape (Hard Rule #12) — the only JS
--      consumer (MemberProfile.jsx "My money") reads named fields, so it is unaffected.
--   2. Class fees in that same list. get_my_money surfaced only source_type='membership'
--      charges; a class booking writes a source_type='class' charge (via
--      _apply_class_booking_charge). Surface those too, for self + children, same shape +
--      a 'stream':'class' tag. This also makes class fees appear on desktop MemberProfile.
--   3. Book a PAID class FOR A CHILD. member_book_class_session books for the caller only
--      (no for_profile_id). guardian_book_class_session mirrors it but books the CHILD into
--      venue_class_bookings + runs the same _apply_class_booking_charge ledger path.
--   + guardian_list_child_class_options(child) → bookable upcoming classes at the venue(s)
--      the child's club runs at (child → club_team_members → club_teams.club_id →
--      club_leagues.venue_id), so the screen can offer them without the client resolving venue.
--
-- "Pay now" needs NO new RPC: the per-charge Stripe hosted-invoice route
-- (api/stripe-charge-checkout.js) reuses venue_charges.pay_url (mig 408) +
-- stripe_set_charge_pay_url + the existing invoice.paid → stripe_record_charge_payment
-- webhook reconcile. This migration is the data layer only.
--
-- SECURITY: guardian gating mirrors migs 426/428 (member_guardians invite_state='accepted').
-- get_my_money keeps its existing membership-scope behaviour unchanged; class stream mirrors it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_my_money — add member_profile_id everywhere + a class-charge stream
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_money()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_person       uuid;
  v_profile      uuid;
  v_memberships  jsonb;
  v_charges      jsonb;
  v_charges_cls  jsonb;
  v_casual       jsonb;
  v_owed         int := 0;
  v_paid_count   int := 0;
  v_upcoming     int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person  FROM public.people          WHERE auth_user_id = v_uid;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;

  WITH mine AS (
    SELECT vm.id, vm.member_profile_id, vm.club_id, vm.tier_id, vm.period,
           vm.amount_pence, vm.status, vm.renews_at, vm.stripe_subscription_id
    FROM public.venue_memberships vm
    WHERE v_profile IS NOT NULL
      AND ( vm.member_profile_id = v_profile
            OR vm.payer_profile_id = v_profile
            OR vm.member_profile_id IN (
                 SELECT mg.child_profile_id FROM public.member_guardians mg
                 WHERE mg.guardian_profile_id = v_profile) )
      AND vm.status <> 'cancelled'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', m.id,
    'member_profile_id', m.member_profile_id,
    'who_for',       CASE WHEN m.member_profile_id = v_profile THEN 'self'
                         ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self',       (m.member_profile_id = v_profile),
    'club_name',     c.name,
    'tier_name',     t.name,
    'period',        m.period,
    'amount_pence',  m.amount_pence,
    'status',        m.status,
    'renews_at',     m.renews_at,
    'is_stripe',     (m.stripe_subscription_id IS NOT NULL)
  ) ORDER BY (m.member_profile_id = v_profile) DESC, c.name NULLS LAST), '[]'::jsonb)
  INTO v_memberships
  FROM mine m
  LEFT JOIN public.member_profiles mp ON mp.id = m.member_profile_id
  LEFT JOIN public.clubs c ON c.id = m.club_id
  LEFT JOIN public.venue_membership_tiers t ON t.id = m.tier_id;

  -- membership charges (existing behaviour) + member_profile_id
  WITH mine AS (
    SELECT vm.id, vm.member_profile_id, vm.club_id
    FROM public.venue_memberships vm
    WHERE v_profile IS NOT NULL
      AND ( vm.member_profile_id = v_profile
            OR vm.payer_profile_id = v_profile
            OR vm.member_profile_id IN (
                 SELECT mg.child_profile_id FROM public.member_guardians mg
                 WHERE mg.guardian_profile_id = v_profile) )
      AND vm.status <> 'cancelled'
  ),
  ch AS (
    SELECT vc.id, vc.amount_due_pence, vc.status, vc.due_date, vc.created_at,
           vc.billing_run_id, vc.venue_id, vc.pay_url,
           m.member_profile_id, m.club_id,
           GREATEST(COALESCE((
             SELECT SUM(CASE WHEN vp.kind='payment' THEN vp.amount_pence ELSE -vp.amount_pence END)
             FROM public.venue_payments vp
             WHERE vp.charge_id = vc.id AND vp.voided_at IS NULL), 0), 0) AS paid_pence
    FROM public.venue_charges vc
    JOIN mine m ON m.id::text = split_part(vc.source_id, ':', 1)
    WHERE vc.source_type = 'membership'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'charge_id',        ch.id,
    'stream',           'membership',
    'member_profile_id', ch.member_profile_id,
    'who_for',          CASE WHEN ch.member_profile_id = v_profile THEN 'self'
                            ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self',          (ch.member_profile_id = v_profile),
    'label',            COALESCE(br.label, c.name, 'Membership'),
    'amount_due_pence', ch.amount_due_pence,
    'paid_pence',       ch.paid_pence,
    'status',           ch.status,
    'due_date',         ch.due_date,
    'pay_url',          COALESCE(ch.pay_url, vn.payment_link)
  ) ORDER BY ch.due_date DESC NULLS LAST, ch.created_at DESC), '[]'::jsonb)
  INTO v_charges
  FROM ch
  LEFT JOIN public.member_profiles mp ON mp.id = ch.member_profile_id
  LEFT JOIN public.clubs c ON c.id = ch.club_id
  LEFT JOIN public.venue_billing_runs br ON br.id = ch.billing_run_id
  LEFT JOIN public.venues vn ON vn.id = ch.venue_id;

  -- class charges for self + the caller's children (same shape, stream='class').
  -- Mirrors the membership-scope set (no invite_state filter) for internal consistency.
  WITH my_profiles AS (
    SELECT v_profile AS pid WHERE v_profile IS NOT NULL
    UNION
    SELECT mg.child_profile_id FROM public.member_guardians mg
     WHERE mg.guardian_profile_id = v_profile
  ),
  clsch AS (
    SELECT vc.id, vc.amount_due_pence, vc.status, vc.due_date, vc.created_at,
           vc.venue_id, vc.pay_url, b.member_profile_id,
           ct.name AS class_name,
           GREATEST(COALESCE((
             SELECT SUM(CASE WHEN vp.kind='payment' THEN vp.amount_pence ELSE -vp.amount_pence END)
             FROM public.venue_payments vp
             WHERE vp.charge_id = vc.id AND vp.voided_at IS NULL), 0), 0) AS paid_pence
    FROM public.venue_charges vc
    JOIN public.venue_class_bookings b ON b.id::text = vc.source_id
    JOIN public.venue_class_sessions s ON s.id = b.session_id
    JOIN public.venue_class_types   ct ON ct.id = s.class_type_id
    WHERE vc.source_type = 'class'
      AND vc.status <> 'refunded'
      AND b.member_profile_id IN (SELECT pid FROM my_profiles WHERE pid IS NOT NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'charge_id',        clsch.id,
    'stream',           'class',
    'member_profile_id', clsch.member_profile_id,
    'who_for',          CASE WHEN clsch.member_profile_id = v_profile THEN 'self'
                            ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self',          (clsch.member_profile_id = v_profile),
    'label',            COALESCE(clsch.class_name, 'Class'),
    'amount_due_pence', clsch.amount_due_pence,
    'paid_pence',       clsch.paid_pence,
    'status',           clsch.status,
    'due_date',         clsch.due_date,
    'pay_url',          COALESCE(clsch.pay_url, vn.payment_link)
  ) ORDER BY clsch.due_date DESC NULLS LAST, clsch.created_at DESC), '[]'::jsonb)
  INTO v_charges_cls
  FROM clsch
  LEFT JOIN public.member_profiles mp ON mp.id = clsch.member_profile_id
  LEFT JOIN public.venues vn ON vn.id = clsch.venue_id;

  v_charges := COALESCE(v_charges, '[]'::jsonb) || COALESCE(v_charges_cls, '[]'::jsonb);

  SELECT
    COALESCE(SUM(CASE WHEN (e->>'status') IN ('unpaid','partial')
                      THEN (e->>'amount_due_pence')::int - (e->>'paid_pence')::int
                      ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE (e->>'status') = 'paid'),
    COUNT(*) FILTER (WHERE (e->>'status') IN ('unpaid','partial'))
  INTO v_owed, v_paid_count, v_upcoming
  FROM jsonb_array_elements(COALESCE(v_charges, '[]'::jsonb)) e;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',         pl.id,
      'team_id',    pl.team_id,
      'player_id',  pl.player_id,
      'match_id',   pl.match_id,
      'amount',     pl.amount,
      'type',       pl.type,
      'status',     pl.status,
      'method',     pl.method,
      'paid_by',    pl.paid_by,
      'paid_at',    pl.paid_at,
      'note',       pl.note,
      'created_at', pl.created_at,
      'updated_at', pl.updated_at
    ) ORDER BY pl.created_at DESC), '[]'::jsonb)
  INTO v_casual
  FROM public.payment_ledger pl
  WHERE v_person IS NOT NULL
    AND pl.player_id IN (
      SELECT p.id FROM public.players p
      WHERE p.person_id = v_person AND COALESCE(p.disabled, false) = false
    );

  RETURN jsonb_build_object(
    'ok',          true,
    'person_id',   v_person,
    'profile_id',  v_profile,
    'memberships', COALESCE(v_memberships, '[]'::jsonb),
    'charges',     COALESCE(v_charges, '[]'::jsonb),
    'casual',      COALESCE(v_casual, '[]'::jsonb),
    'summary',     jsonb_build_object(
                     'owed_pence',     v_owed,
                     'paid_count',     v_paid_count,
                     'upcoming_count', v_upcoming)
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. guardian_book_class_session(session, for_profile) — book a paid class FOR A CHILD.
--    Guardian-gated mirror of member_book_class_session; books the CHILD into
--    venue_class_bookings + runs the same _apply_class_booking_charge ledger path.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_book_class_session(
  p_session_id     uuid,
  p_for_profile_id uuid DEFAULT NULL
)
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_caller FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  -- Resolve target: a child (guardian-gated) or self.
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

  IF v_sess.payment_mode = 'prepay' THEN
    SELECT EXISTS (SELECT 1 FROM public.venue_integrations
                    WHERE venue_id = v_sess.venue_id AND provider = 'stripe' AND status = 'connected')
      INTO v_connected;
    IF NOT v_connected THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'payment_method_unavailable');
    END IF;
  END IF;

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
                            'waitlist_position', v_wpos);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_book_class_session(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardian_book_class_session(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. guardian_list_child_class_options(child) — bookable upcoming classes at the
--    venue(s) the child's club runs at. Read-only; guardian-gated like migs 426/428.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_list_child_class_options(
  p_child_profile_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid            uuid := auth.uid();
  v_caller_profile uuid;
  v_options        jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_caller_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001';
  END IF;

  IF p_child_profile_id <> v_caller_profile AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller_profile
      AND child_profile_id    = p_child_profile_id
      AND invite_state        = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001';
  END IF;

  WITH child_venues AS (
    -- venue(s) the child's active club teams run at, via the club's leagues.
    SELECT DISTINCT cl.venue_id
    FROM public.club_team_members ctm
    JOIN public.club_teams ct ON ct.id = ctm.team_id
    JOIN public.club_leagues cl ON cl.club_id = ct.club_id AND cl.archived_at IS NULL
    WHERE ctm.member_profile_id = p_child_profile_id
      AND ctm.is_active = true
      AND cl.venue_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id',   s.id,
    'venue_id',     s.venue_id,
    'class_name',   ctp.name,
    'starts_at',    s.starts_at,
    'price_pence',  s.price_pence,
    'payment_mode', s.payment_mode,
    'members_only', COALESCE(ctp.members_only, true),
    'capacity',     s.capacity,
    'spots_left',   GREATEST(s.capacity - (
                      SELECT count(*) FROM public.venue_class_bookings b
                      WHERE b.session_id = s.id
                        AND (b.status = 'confirmed'
                             OR (b.status = 'offered' AND b.offer_expires_at > now()))
                    ), 0),
    'already_booked', EXISTS (
                      SELECT 1 FROM public.venue_class_bookings b
                      WHERE b.session_id = s.id
                        AND b.member_profile_id = p_child_profile_id
                        AND b.status IN ('confirmed','waitlist','offered'))
  ) ORDER BY s.starts_at), '[]'::jsonb)
  INTO v_options
  FROM public.venue_class_sessions s
  JOIN public.venue_class_types ctp ON ctp.id = s.class_type_id
  WHERE s.venue_id IN (SELECT venue_id FROM child_venues)
    AND s.status = 'scheduled'
    AND s.starts_at > now()
    AND COALESCE(ctp.is_active, true) = true;

  RETURN jsonb_build_object('ok', true, 'child_profile_id', p_child_profile_id,
                            'options', COALESCE(v_options, '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_list_child_class_options(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.guardian_list_child_class_options(uuid) TO anon, authenticated;
