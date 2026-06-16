-- 344_class_packages_down.sql — reverse Phase 7 (class packages & trials).
--
-- Restores the mig 340/341/339 versions of the four re-issued functions, drops the
-- 5 new package RPCs, the booking link column, the two tables, and reverts the
-- venue_charges source_type CHECK. NOTE: restoring _apply_class_booking_charge and
-- member_cancel_class_booking to their pre-Phase-7 bodies removes the package
-- branch / credit-restore; any outstanding package balances become unspendable but
-- the rows are dropped with the tables.

-- ── restore _apply_class_booking_charge (mig 340 body) ────────────────────────
CREATE OR REPLACE FUNCTION public._apply_class_booking_charge(p_booking_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_bk public.venue_class_bookings; v_sess public.venue_class_sessions; v_ct public.venue_class_types;
  v_benefits jsonb := '{}'::jsonb; v_discount numeric := 0; v_included int := 0; v_amount int;
  v_waived boolean := false; v_method text; v_prior int;
BEGIN
  SELECT * INTO v_bk FROM public.venue_class_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_bk.status <> 'confirmed' THEN RETURN; END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = v_bk.session_id;
  SELECT * INTO v_ct   FROM public.venue_class_types    WHERE id = v_sess.class_type_id;
  SELECT t.benefits INTO v_benefits FROM public.venue_memberships m
    JOIN public.venue_membership_tiers t ON t.id = m.tier_id
   WHERE m.member_profile_id = v_bk.member_profile_id AND m.venue_id = v_sess.venue_id
     AND m.status IN ('active','ending') ORDER BY m.created_at DESC LIMIT 1;
  v_benefits := COALESCE(v_benefits, '{}'::jsonb);
  IF jsonb_typeof(v_benefits->'discount_pct') = 'number' THEN
    v_discount := LEAST(GREATEST((v_benefits->>'discount_pct')::numeric, 0), 100); END IF;
  IF jsonb_typeof(v_benefits->'included_sessions') = 'number' THEN
    v_included := GREATEST((v_benefits->>'included_sessions')::int, 0); END IF;
  v_method := CASE WHEN v_sess.payment_mode = 'prepay' THEN 'prepay' ELSE 'door' END;
  v_amount := round(v_sess.price_pence * (100 - v_discount) / 100.0);
  IF v_ct.first_session_free THEN
    SELECT count(*) INTO v_prior FROM public.venue_class_bookings b
      JOIN public.venue_class_sessions s ON s.id = b.session_id
     WHERE b.member_profile_id = v_bk.member_profile_id AND s.venue_id = v_sess.venue_id
       AND b.id <> p_booking_id AND b.status IN ('confirmed','no_show');
    IF v_prior = 0 THEN v_waived := true; END IF;
  END IF;
  IF v_included > 0 OR v_amount <= 0 THEN v_waived := true; END IF;
  IF v_waived THEN
    UPDATE public.venue_class_bookings SET payment_status='waived', payment_method='not_yet' WHERE id=p_booking_id;
  ELSE
    UPDATE public.venue_class_bookings SET payment_status='pending', payment_method=v_method WHERE id=p_booking_id;
    IF NOT EXISTS (SELECT 1 FROM public.venue_charges WHERE source_type='class' AND source_id=p_booking_id::text AND status<>'refunded') THEN
      INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
      VALUES (v_sess.venue_id, 'class', p_booking_id::text, v_amount, 'unpaid', v_sess.starts_at::date);
    END IF;
  END IF;
END; $fn$;
REVOKE ALL ON FUNCTION public._apply_class_booking_charge(uuid) FROM PUBLIC, anon, authenticated;

-- ── restore member_cancel_class_booking (mig 341 body) ────────────────────────
CREATE OR REPLACE FUNCTION public.member_cancel_class_booking(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid; v_bk public.venue_class_bookings; v_sess public.venue_class_sessions;
  v_ct public.venue_class_types; v_venue_id text; v_was text; v_refunded int := 0; v_offered uuid; v_frees_seat boolean;
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
  IF v_was = 'confirmed' AND now() > v_sess.starts_at - (v_ct.cancellation_cutoff_hours * INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'cutoff_passed' USING ERRCODE='P0001';
  END IF;
  v_frees_seat := (v_was = 'confirmed') OR (v_was = 'offered' AND v_bk.offer_expires_at IS NOT NULL AND v_bk.offer_expires_at > now());
  UPDATE public.venue_class_bookings SET status='cancelled', cancelled_at=now(), waitlist_position=NULL, offer_expires_at=NULL WHERE id=p_booking_id;
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
          jsonb_build_object('session_id', v_bk.session_id, 'was', v_was, 'refunded', v_refunded, 'offered', v_offered));
  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'refunded', v_refunded, 'offered', (v_offered IS NOT NULL));
END; $fn$;
REVOKE ALL ON FUNCTION public.member_cancel_class_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_cancel_class_booking(uuid) TO authenticated;

-- ── restore venue_cancel_class_session (mig 339 forward-guarded body) ─────────
CREATE OR REPLACE FUNCTION public.venue_cancel_class_session(p_venue_token text, p_session_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_sess public.venue_class_sessions; v_refunded int := 0; v_notified int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'already', true, 'session_id', p_session_id); END IF;
  UPDATE public.venue_class_sessions SET status='cancelled', cancellation_reason=p_reason WHERE id=p_session_id;
  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    EXECUTE format($q$ UPDATE public.venue_charges c SET status='refunded'
       WHERE c.source_type='class' AND c.status<>'refunded'
         AND c.source_id IN (SELECT b.id::text FROM public.venue_class_bookings b WHERE b.session_id=%L) $q$, p_session_id);
    GET DIAGNOSTICS v_refunded = ROW_COUNT;
    EXECUTE format($q$ UPDATE public.venue_class_bookings b SET status='cancelled', cancelled_at=now()
       WHERE b.session_id=%L AND b.status IN ('confirmed','waitlist') $q$, p_session_id);
    GET DIAGNOSTICS v_notified = ROW_COUNT;
    EXECUTE format($q$ INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
      SELECT %L, b.member_profile_id::text, 'class_cancelled', %L, mp.email, now(), jsonb_build_object('reason', %L)
        FROM public.venue_class_bookings b JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.session_id=%L AND b.status='cancelled' $q$, v_caller.venue_id, p_session_id::text, p_reason, p_session_id);
  END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_session_cancelled', 'venue_class_session', p_session_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason, 'refunded', v_refunded, 'notified', v_notified));
  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'refunded', v_refunded, 'notified', v_notified);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_class_session(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_class_session(text,uuid,text) TO anon, authenticated;

-- ── restore venue_cancel_class_series (mig 339 forward-guarded body) ──────────
CREATE OR REPLACE FUNCTION public.venue_cancel_class_series(p_venue_token text, p_series_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_cancelled int := 0; v_refunded int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  SELECT ct.venue_id INTO v_venue_id FROM public.venue_class_series s
    JOIN public.venue_class_types ct ON ct.id = s.class_type_id WHERE s.id = p_series_id;
  IF v_venue_id IS NULL OR v_venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE='P0001'; END IF;
  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    EXECUTE format($q$ UPDATE public.venue_charges c SET status='refunded'
       WHERE c.source_type='class' AND c.status<>'refunded'
         AND c.source_id IN (SELECT b.id::text FROM public.venue_class_bookings b
           JOIN public.venue_class_sessions cs ON cs.id = b.session_id
           WHERE cs.series_id=%L AND cs.status='scheduled' AND cs.starts_at>now()) $q$, p_series_id);
    GET DIAGNOSTICS v_refunded = ROW_COUNT;
    EXECUTE format($q$ INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
      SELECT %L, b.member_profile_id::text, 'class_cancelled', cs.id::text, mp.email, now(), jsonb_build_object('reason', %L, 'series_id', %L)
        FROM public.venue_class_bookings b JOIN public.venue_class_sessions cs ON cs.id = b.session_id
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE cs.series_id=%L AND cs.status='scheduled' AND cs.starts_at>now() AND b.status IN ('confirmed','waitlist') $q$,
       v_caller.venue_id, p_reason, p_series_id, p_series_id);
    EXECUTE format($q$ UPDATE public.venue_class_bookings b SET status='cancelled', cancelled_at=now()
       WHERE b.status IN ('confirmed','waitlist')
         AND b.session_id IN (SELECT cs.id FROM public.venue_class_sessions cs
           WHERE cs.series_id=%L AND cs.status='scheduled' AND cs.starts_at>now()) $q$, p_series_id);
  END IF;
  UPDATE public.venue_class_sessions SET status='cancelled', cancellation_reason=p_reason
   WHERE series_id = p_series_id AND status='scheduled' AND starts_at>now();
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  UPDATE public.venue_class_series SET is_active = false WHERE id = p_series_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_series_cancelled', 'venue_class_series', p_series_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason, 'sessions_cancelled', v_cancelled, 'refunded', v_refunded));
  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id, 'sessions_cancelled', v_cancelled, 'refunded', v_refunded);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_class_series(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_class_series(text,uuid,text) TO anon, authenticated;

-- ── drop the new package RPCs ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.venue_create_class_package(text,text,int,int,int);
DROP FUNCTION IF EXISTS public.venue_list_class_packages(text);
DROP FUNCTION IF EXISTS public.member_list_class_packages(text);
DROP FUNCTION IF EXISTS public.member_purchase_class_package(uuid);
DROP FUNCTION IF EXISTS public.member_get_package_balance(text);

-- ── revert venue_charges source_type CHECK (drop 'class_package') ──────────────
ALTER TABLE public.venue_charges DROP CONSTRAINT IF EXISTS venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership','merchandise','class','room_hire']));

-- ── drop link column + tables ─────────────────────────────────────────────────
ALTER TABLE public.venue_class_bookings DROP COLUMN IF EXISTS package_balance_id;
DROP TABLE IF EXISTS public.venue_member_package_balances;
DROP TABLE IF EXISTS public.venue_class_packages;

SELECT pg_notify('pgrst', 'reload schema');
