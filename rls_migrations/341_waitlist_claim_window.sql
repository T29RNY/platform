-- 341_waitlist_claim_window.sql
--
-- Classes Booking + Room Hire — Phase 4: Waitlist claim-window (notify-and-claim).
--
-- Phase 3 (mig 340) auto-PROMOTED the next waitlister the instant a confirmed seat
-- freed. Phase 4 replaces that with NOTIFY-AND-CLAIM — the same pattern as the
-- reserve-spot flow (mig 230): on a freed seat we OFFER it to the next waitlister
-- with a time-boxed claim window; the member taps to claim. If the window lapses
-- unclaimed, the offer rolls to the next waitlister.
--
-- Mechanics:
--   • venue_class_bookings.status gains 'offered'; new column offer_expires_at.
--   • venues.class_claim_window_minutes (DEFAULT 30) — per-venue claim window.
--   • An 'offered' booking RESERVES the seat: it counts toward capacity exactly
--     like 'confirmed' (only while offer_expires_at > now()). This makes the claim
--     atomic — no new booker can steal a held seat, and the offered member's claim
--     essentially always succeeds inside the window. Charge is applied on CLAIM,
--     never on offer.
--   • _offer_next_waitlist_spot(session_id) — internal; single source for "a seat
--     is free → offer the front waitlister". Called by member_cancel_class_booking
--     AND by the cron expiry sweep (drains expired offers, then re-offers).
--   • member_claim_waitlist_spot(session_id) — authenticated; atomic check-and-
--     promote of the caller's live offer; graceful {ok:false, reason:'spot_taken'}
--     when the offer expired / was rolled away / the session is gone.
--
-- member_cancel_class_booking is rewired: the straight auto-promote block becomes a
-- call to _offer_next_waitlist_spot, and an 'offered' booking is now itself
-- cancellable (a decline → rolls the offer onward). Its return field 'promoted' is
-- replaced by 'offered' (Hard Rule #7: grepped — no JS/SQL consumer reads it).
--
-- venue_cancel_class_session / _series are NOT touched: they cancel the whole
-- session and every booking, so there is no freed seat to offer.
--
-- All member RPCs: SECURITY DEFINER, search_path pinned, auth via auth.uid(),
-- audited with actor_type='player' (the mig-297/335 constraint trap).

-- ── 1. schema delta ───────────────────────────────────────────────────────────

ALTER TABLE public.venue_class_bookings
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

ALTER TABLE public.venue_class_bookings
  DROP CONSTRAINT IF EXISTS venue_class_bookings_status_check;
ALTER TABLE public.venue_class_bookings
  ADD CONSTRAINT venue_class_bookings_status_check
  CHECK (status IN ('confirmed','waitlist','offered','cancelled','no_show'));

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS class_claim_window_minutes int NOT NULL DEFAULT 30
    CHECK (class_claim_window_minutes > 0);

-- ── 2. _offer_next_waitlist_spot (internal helper) ────────────────────────────
-- If the session has a free seat (capacity > confirmed + live offers) and is still
-- future/scheduled, offer it to the front waitlister: status -> 'offered',
-- offer_expires_at -> now() + venue window, and queue a 'class_spot_offered'
-- notification (drained by classNotificationsJob, email-only for now). No-op if no
-- free seat or no waitlister. Never granted to clients.

CREATE OR REPLACE FUNCTION public._offer_next_waitlist_spot(p_session_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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

  -- occupied = confirmed + currently-live offers (held seats)
  SELECT count(*) INTO v_occupied FROM public.venue_class_bookings
   WHERE session_id = p_session_id
     AND (status = 'confirmed'
          OR (status = 'offered' AND offer_expires_at > now()));
  IF v_sess.capacity <= 0 OR v_occupied >= v_sess.capacity THEN
    RETURN NULL;  -- no free seat
  END IF;

  -- front of the waitlist
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
$fn$;
REVOKE ALL ON FUNCTION public._offer_next_waitlist_spot(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. member_book_class_session — count live offers toward capacity ──────────
-- Reissued so a held (offered) seat is treated as occupied: a new booker can't jump
-- a seat that's being offered to a waitlister. Only this capacity clause changes
-- vs mig 340.

CREATE OR REPLACE FUNCTION public.member_book_class_session(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   public.member_profiles;
  v_sess      public.venue_class_sessions;
  v_threshold int;
  v_occupied  int;
  v_existing  public.venue_class_bookings;
  v_status    text;
  v_wpos      int;
  v_booking_id uuid;
  v_connected boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RAISE EXCEPTION 'session_not_bookable' USING ERRCODE='P0001';
  END IF;

  -- active-membership gate (classes are member-only)
  IF NOT EXISTS (SELECT 1 FROM public.venue_memberships
                  WHERE member_profile_id = v_profile.id AND venue_id = v_sess.venue_id
                    AND status IN ('active','ending')) THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE='P0001';
  END IF;

  -- no-show suspension gate
  SELECT no_show_suspension_threshold INTO v_threshold FROM public.venues WHERE id = v_sess.venue_id;
  IF v_threshold IS NOT NULL AND v_profile.no_show_count >= v_threshold THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suspended', 'no_show_count', v_profile.no_show_count);
  END IF;

  -- Stripe prepay dormancy gate
  IF v_sess.payment_mode = 'prepay' THEN
    SELECT EXISTS (SELECT 1 FROM public.venue_integrations
                    WHERE venue_id = v_sess.venue_id AND provider = 'stripe' AND status = 'connected')
      INTO v_connected;
    IF NOT v_connected THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'payment_method_unavailable');
    END IF;
  END IF;

  -- already booked?
  SELECT * INTO v_existing FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_profile.id;
  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed','waitlist','offered') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_booked',
                              'booking_id', v_existing.id, 'status', v_existing.status);
  END IF;

  -- capacity decision: a seat is taken by a confirmed booking OR a live offer
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
    -- re-book a previously cancelled/no_show row (UNIQUE(session,member) holds)
    UPDATE public.venue_class_bookings
       SET status = v_status, waitlist_position = v_wpos, booked_at = now(),
           cancelled_at = NULL, offer_expires_at = NULL,
           payment_status = 'pending', payment_method = 'not_yet'
     WHERE id = v_existing.id
     RETURNING id INTO v_booking_id;
  ELSE
    INSERT INTO public.venue_class_bookings (session_id, member_profile_id, status, waitlist_position)
    VALUES (p_session_id, v_profile.id, v_status, v_wpos)
    RETURNING id INTO v_booking_id;
  END IF;

  IF v_status = 'confirmed' THEN
    PERFORM public._apply_class_booking_charge(v_booking_id);
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings WHERE id = v_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_sess.venue_id, v_uid, 'player', 'member_class_booked', 'venue_class_booking', v_booking_id::text,
          jsonb_build_object('session_id', p_session_id, 'status', v_status,
                             'member_profile_id', v_profile.id, 'waitlist_position', v_wpos));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', v_status,
                            'payment_status', v_existing.payment_status,
                            'payment_method', v_existing.payment_method,
                            'waitlist_position', v_wpos);
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_book_class_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_book_class_session(uuid) TO authenticated;

-- ── 4. member_cancel_class_booking — offer-not-promote (Phase 4 rewire) ───────
-- Enforces cancellation_cutoff_hours (confirmed only); refunds any class charge;
-- on a freed CONFIRMED seat, OFFERS the next waitlister via _offer_next_waitlist_spot
-- (no longer promotes). An 'offered' booking is now itself cancellable (a decline),
-- which frees its held seat and rolls the offer onward. Return field 'promoted'
-- becomes 'offered'.

CREATE OR REPLACE FUNCTION public.member_cancel_class_booking(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_bk         public.venue_class_bookings;
  v_sess       public.venue_class_sessions;
  v_ct         public.venue_class_types;
  v_venue_id   text;
  v_was        text;
  v_refunded   int := 0;
  v_offered    uuid;
  v_frees_seat boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_bk FROM public.venue_class_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_bk.member_profile_id <> v_profile_id THEN
    RAISE EXCEPTION 'booking_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_bk.status NOT IN ('confirmed','waitlist','offered') THEN
    RAISE EXCEPTION 'not_cancellable' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = v_bk.session_id;
  SELECT * INTO v_ct   FROM public.venue_class_types    WHERE id = v_sess.class_type_id;
  v_venue_id := v_sess.venue_id;
  v_was      := v_bk.status;

  -- cancellation cutoff applies to confirmed bookings only
  IF v_was = 'confirmed'
     AND now() > v_sess.starts_at - (v_ct.cancellation_cutoff_hours * INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'cutoff_passed' USING ERRCODE='P0001';
  END IF;

  -- a confirmed or a live offer holds a seat; cancelling either frees one
  v_frees_seat := (v_was = 'confirmed')
               OR (v_was = 'offered' AND v_bk.offer_expires_at IS NOT NULL AND v_bk.offer_expires_at > now());

  UPDATE public.venue_class_bookings
     SET status = 'cancelled', cancelled_at = now(), waitlist_position = NULL, offer_expires_at = NULL
   WHERE id = p_booking_id;

  -- refund / void any class charge for this booking
  UPDATE public.venue_charges SET status = 'refunded'
   WHERE source_type = 'class' AND source_id = p_booking_id::text AND status <> 'refunded';
  GET DIAGNOSTICS v_refunded = ROW_COUNT;

  -- a freed seat → OFFER (not promote) the next waitlister
  IF v_frees_seat AND v_sess.status = 'scheduled' AND v_sess.starts_at > now() THEN
    v_offered := public._offer_next_waitlist_spot(v_bk.session_id);
  END IF;

  -- cancellation confirmation to the cancelling member
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_venue_id, v_profile_id::text, 'class_booking_cancelled', p_booking_id::text, mp.email, now(),
         jsonb_build_object('session_id', v_bk.session_id)
    FROM public.member_profiles mp WHERE mp.id = v_profile_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, v_uid, 'player', 'member_class_cancelled', 'venue_class_booking', p_booking_id::text,
          jsonb_build_object('session_id', v_bk.session_id, 'was', v_was,
                             'refunded', v_refunded, 'offered', v_offered));

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id,
                            'refunded', v_refunded, 'offered', (v_offered IS NOT NULL));
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_cancel_class_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_cancel_class_booking(uuid) TO authenticated;

-- ── 5. member_claim_waitlist_spot ─────────────────────────────────────────────
-- The caller taps to claim a spot they've been offered. Atomic: re-checks the offer
-- is still live AND the seat still fits (defensive — the offer reserves the seat, so
-- this normally holds), promotes 'offered' -> 'confirmed', applies the charge, and
-- clears offer_expires_at. Graceful {ok:false, reason:'spot_taken'} when the offer
-- expired / rolled away / the session is no longer bookable.

CREATE OR REPLACE FUNCTION public.member_claim_waitlist_spot(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_bk         public.venue_class_bookings;
  v_sess       public.venue_class_sessions;
  v_confirmed  int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  -- lock the caller's booking row for this session to serialise concurrent claims
  SELECT * INTO v_bk FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spot_taken');
  END IF;

  -- offer must be live
  IF v_bk.status <> 'offered' OR v_bk.offer_expires_at IS NULL OR v_bk.offer_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spot_taken');
  END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spot_taken');
  END IF;

  -- defensive capacity re-check (exclude this caller's own held seat)
  SELECT count(*) INTO v_confirmed FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND status = 'confirmed' AND id <> v_bk.id;
  IF v_sess.capacity > 0 AND v_confirmed >= v_sess.capacity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spot_taken');
  END IF;

  UPDATE public.venue_class_bookings
     SET status = 'confirmed', waitlist_position = NULL, offer_expires_at = NULL, booked_at = now()
   WHERE id = v_bk.id;

  PERFORM public._apply_class_booking_charge(v_bk.id);
  SELECT * INTO v_bk FROM public.venue_class_bookings WHERE id = v_bk.id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_sess.venue_id, v_uid, 'player', 'member_class_claimed', 'venue_class_booking', v_bk.id::text,
          jsonb_build_object('session_id', p_session_id, 'member_profile_id', v_profile_id));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_bk.id, 'status', 'confirmed',
                            'payment_status', v_bk.payment_status, 'payment_method', v_bk.payment_method);
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_claim_waitlist_spot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_claim_waitlist_spot(uuid) TO authenticated;

-- ── 6. member_list_class_sessions — held seats reduce spots_left, expose offer ─
-- spots_left now subtracts live offers as well as confirmed (a held seat is not
-- bookable). Adds my_offer_expires_at so the caller's claim countdown can render.

CREATE OR REPLACE FUNCTION public.member_list_class_sessions(
  p_venue_id text,
  p_from     timestamptz DEFAULT NULL,
  p_to       timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_from       timestamptz;
  v_to         timestamptz;
  v_result     jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  END IF;
  v_from := COALESCE(p_from, now());
  v_to   := COALESCE(p_to, now() + INTERVAL '28 days');

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.starts_at), '[]'::jsonb) INTO v_result FROM (
    SELECT cs.id AS session_id, cs.venue_id, cs.class_type_id, ct.name AS class_name, ct.category,
           ct.description, ct.cancellation_cutoff_hours, ct.first_session_free,
           cs.space_id, sp.name AS space_name, cs.instructor_id, va.email AS instructor_email,
           cs.starts_at, cs.ends_at, cs.capacity, cs.price_pence, cs.payment_mode,
           (SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.status = 'confirmed')::int AS booked_count,
           (SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.status = 'waitlist')::int  AS waitlist_count,
           GREATEST(cs.capacity - (SELECT count(*) FROM public.venue_class_bookings b
                                    WHERE b.session_id = cs.id
                                      AND (b.status = 'confirmed'
                                           OR (b.status = 'offered' AND b.offer_expires_at > now()))), 0)::int AS spots_left,
           (SELECT b.status            FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_status,
           (SELECT b.id                FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_booking_id,
           (SELECT b.waitlist_position FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_waitlist_position,
           (SELECT b.offer_expires_at  FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_offer_expires_at
    FROM public.venue_class_sessions cs
    JOIN public.venue_class_types ct ON ct.id = cs.class_type_id
    JOIN public.venue_spaces sp ON sp.id = cs.space_id
    LEFT JOIN public.venue_admins va ON va.id = cs.instructor_id
    WHERE cs.venue_id = p_venue_id
      AND cs.status = 'scheduled'
      AND cs.starts_at >= v_from
      AND cs.starts_at <= v_to
  ) x;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_list_class_sessions(text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_list_class_sessions(text,timestamptz,timestamptz) TO anon, authenticated;

-- ── 7. member_list_my_class_bookings — expose offer state, 'offered' is upcoming ─

CREATE OR REPLACE FUNCTION public.member_list_my_class_bookings(p_venue_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.starts_at DESC), '[]'::jsonb) INTO v_result FROM (
    SELECT b.id AS booking_id, b.status, b.payment_status, b.payment_method, b.waitlist_position,
           b.offer_expires_at, b.booked_at, b.cancelled_at,
           cs.id AS session_id, cs.venue_id, vn.name AS venue_name, ct.name AS class_name, ct.category,
           cs.space_id, sp.name AS space_name, cs.instructor_id, va.email AS instructor_email,
           cs.starts_at, cs.ends_at, cs.price_pence, cs.status AS session_status,
           ct.cancellation_cutoff_hours,
           (cs.starts_at >= now() AND b.status IN ('confirmed','waitlist','offered')) AS is_upcoming
    FROM public.venue_class_bookings b
    JOIN public.venue_class_sessions cs ON cs.id = b.session_id
    JOIN public.venue_class_types ct ON ct.id = cs.class_type_id
    JOIN public.venue_spaces sp ON sp.id = cs.space_id
    JOIN public.venues vn ON vn.id = cs.venue_id
    LEFT JOIN public.venue_admins va ON va.id = cs.instructor_id
    WHERE b.member_profile_id = v_profile_id
      AND (p_venue_id IS NULL OR cs.venue_id = p_venue_id)
  ) x;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_list_my_class_bookings(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_list_my_class_bookings(text) TO authenticated;

-- ── 8. expire_class_waitlist_offers (cron tick) ───────────────────────────────
-- Drains offers whose claim window lapsed: each expired 'offered' booking returns to
-- the BACK of its session's waitlist (so the offer rolls to the next person), then we
-- re-offer the front waitlister of every affected session. Returns a count of expired
-- offers for the cron log. Service-role only.

CREATE OR REPLACE FUNCTION public.expire_class_waitlist_offers()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_sid     uuid;
  v_expired int := 0;
  v_reoffered int := 0;
BEGIN
  -- collect affected sessions BEFORE mutating
  CREATE TEMP TABLE _expired_sessions ON COMMIT DROP AS
    SELECT DISTINCT session_id FROM public.venue_class_bookings
     WHERE status = 'offered' AND offer_expires_at IS NOT NULL AND offer_expires_at <= now();

  -- expired offers → back of their waitlist (new max position + 1, per session).
  -- row_number lives in the CTE (window functions are illegal in UPDATE ... SET).
  WITH expired AS (
    SELECT id, session_id, booked_at FROM public.venue_class_bookings
     WHERE status = 'offered' AND offer_expires_at IS NOT NULL AND offer_expires_at <= now()
  ),
  maxpos AS (
    SELECT session_id, COALESCE(max(waitlist_position), 0) AS m
      FROM public.venue_class_bookings WHERE status = 'waitlist' GROUP BY session_id
  ),
  ranked AS (
    SELECT e.id,
           COALESCE(mp.m, 0)
             + row_number() OVER (PARTITION BY e.session_id ORDER BY e.booked_at) AS newpos
      FROM expired e
      LEFT JOIN maxpos mp ON mp.session_id = e.session_id
  )
  UPDATE public.venue_class_bookings b
     SET status = 'waitlist', offer_expires_at = NULL, waitlist_position = r.newpos
    FROM ranked r
   WHERE b.id = r.id;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- re-offer each affected session
  FOR v_sid IN SELECT session_id FROM _expired_sessions LOOP
    IF public._offer_next_waitlist_spot(v_sid) IS NOT NULL THEN
      v_reoffered := v_reoffered + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('expired', v_expired, 'reoffered', v_reoffered);
END;
$fn$;
REVOKE ALL ON FUNCTION public.expire_class_waitlist_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_class_waitlist_offers() TO service_role;

-- Refresh PostgREST's function-signature cache.
SELECT pg_notify('pgrst', 'reload schema');
