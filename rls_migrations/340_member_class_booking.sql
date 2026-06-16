-- 340_member_class_booking.sql
--
-- Classes Booking + Room Hire — Phase 3: Member booking & timetable.
--
-- Lands the member (authenticated) side of classes:
--   • venue_class_bookings  — one row per (session, member). status
--     confirmed/waitlist/cancelled/no_show; payment_status pending/paid/waived;
--     payment_method prepay/door/not_yet; waitlist_position; UNIQUE(session,member).
--   • member_profiles.no_show_count            (deferred from Phase 2 — lands HERE)
--   • venues.no_show_suspension_threshold      (NULL = no policy)
--   • 4 member RPCs: list sessions (public timetable + per-caller booking state),
--     book, cancel, list-my-bookings.
--   • _apply_class_booking_charge(booking_id)  — internal helper; the single place
--     that decides waive vs charge for a *confirmed* booking. Reused by book() and
--     by the cancel() waitlist auto-promotion so the two paths can never diverge.
--
-- ACTIVATES two Phase-2 forward-guarded cascades the instant this migration applies:
--   1. venue_cancel_class_session / _series refund cascade keys on
--      venue_charges.source_type='class' AND source_id = venue_class_bookings.id::text
--      — so the charge INSERT below uses EXACTLY that shape (Hard Rule #14 contract,
--      recorded in RPCS.md by mig 339).
--   2. venue_mark_class_completed flips un-checked-in 'confirmed' bookings → 'no_show'
--      and bumps member_profiles.no_show_count (runtime-probed). Both objects exist
--      after this migration, so that cascade begins enforcing automatically.
--
-- Stripe prepay stays DORMANT: a session with payment_mode='prepay' is rejected by
-- member_book_class_session with {ok:false, reason:'payment_method_unavailable'}
-- unless a venue_integrations row provider='stripe' AND status='connected' exists.
--
-- Tier benefits (venue_membership_tiers.benefits jsonb): 'included_sessions' (>0)
-- waives the class charge; 'discount_pct' reduces it; the class type's
-- first_session_free waives the caller's first-ever booking at that venue.
--
-- All member RPCs: SECURITY DEFINER, search_path pinned, auth via auth.uid(),
-- audited with actor_type='player' (NOT 'member' — the mig-297/335 constraint trap).

-- ── 1. venue_class_bookings ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_class_bookings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        NOT NULL REFERENCES public.venue_class_sessions(id) ON DELETE CASCADE,
  member_profile_id uuid        NOT NULL REFERENCES public.member_profiles(id)      ON DELETE CASCADE,
  status            text        NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','waitlist','cancelled','no_show')),
  payment_status    text        NOT NULL DEFAULT 'pending'   CHECK (payment_status IN ('pending','paid','waived')),
  payment_method    text        NOT NULL DEFAULT 'not_yet'   CHECK (payment_method IN ('prepay','door','not_yet')),
  waitlist_position int,
  booked_at         timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  UNIQUE (session_id, member_profile_id)
);
CREATE INDEX IF NOT EXISTS venue_class_bookings_session_idx ON public.venue_class_bookings (session_id);
CREATE INDEX IF NOT EXISTS venue_class_bookings_member_idx  ON public.venue_class_bookings (member_profile_id);

-- Writes/reads only through the SECURITY DEFINER RPCs below. No direct client access.
ALTER TABLE public.venue_class_bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_class_bookings FROM PUBLIC, anon, authenticated;

-- ── 2. new columns ───────────────────────────────────────────────────────────

ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS no_show_count int NOT NULL DEFAULT 0
    CHECK (no_show_count >= 0);

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS no_show_suspension_threshold int
    CHECK (no_show_suspension_threshold IS NULL OR no_show_suspension_threshold >= 0);

-- ── 3. _apply_class_booking_charge (internal helper) ─────────────────────────
-- Given a booking that is already 'confirmed', decides waive vs charge and writes
-- the venue_charges row. Single source of truth for booking-charge logic — called
-- by member_book_class_session and by the cancel() waitlist auto-promote path.
-- Never granted to clients; only ever called from the SECURITY DEFINER RPCs below.

CREATE OR REPLACE FUNCTION public._apply_class_booking_charge(p_booking_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_bk       public.venue_class_bookings;
  v_sess     public.venue_class_sessions;
  v_ct       public.venue_class_types;
  v_benefits jsonb   := '{}'::jsonb;
  v_discount numeric := 0;
  v_included int     := 0;
  v_amount   int;
  v_waived   boolean := false;
  v_method   text;
  v_prior    int;
BEGIN
  SELECT * INTO v_bk FROM public.venue_class_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_bk.status <> 'confirmed' THEN RETURN; END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = v_bk.session_id;
  SELECT * INTO v_ct   FROM public.venue_class_types    WHERE id = v_sess.class_type_id;

  -- benefits of this member's active membership at the venue (most recent)
  SELECT t.benefits INTO v_benefits
    FROM public.venue_memberships m
    JOIN public.venue_membership_tiers t ON t.id = m.tier_id
   WHERE m.member_profile_id = v_bk.member_profile_id
     AND m.venue_id = v_sess.venue_id
     AND m.status IN ('active','ending')
   ORDER BY m.created_at DESC LIMIT 1;
  v_benefits := COALESCE(v_benefits, '{}'::jsonb);

  IF jsonb_typeof(v_benefits->'discount_pct') = 'number' THEN
    v_discount := LEAST(GREATEST((v_benefits->>'discount_pct')::numeric, 0), 100);
  END IF;
  IF jsonb_typeof(v_benefits->'included_sessions') = 'number' THEN
    v_included := GREATEST((v_benefits->>'included_sessions')::int, 0);
  END IF;

  v_method := CASE WHEN v_sess.payment_mode = 'prepay' THEN 'prepay' ELSE 'door' END;
  v_amount := round(v_sess.price_pence * (100 - v_discount) / 100.0);

  -- first-session-free: no prior confirmed/no_show booking by this member at this venue
  IF v_ct.first_session_free THEN
    SELECT count(*) INTO v_prior
      FROM public.venue_class_bookings b
      JOIN public.venue_class_sessions s ON s.id = b.session_id
     WHERE b.member_profile_id = v_bk.member_profile_id
       AND s.venue_id = v_sess.venue_id
       AND b.id <> p_booking_id
       AND b.status IN ('confirmed','no_show');
    IF v_prior = 0 THEN v_waived := true; END IF;
  END IF;

  IF v_included > 0 OR v_amount <= 0 THEN v_waived := true; END IF;

  IF v_waived THEN
    UPDATE public.venue_class_bookings
       SET payment_status = 'waived', payment_method = 'not_yet'
     WHERE id = p_booking_id;
  ELSE
    UPDATE public.venue_class_bookings
       SET payment_status = 'pending', payment_method = v_method
     WHERE id = p_booking_id;
    IF NOT EXISTS (SELECT 1 FROM public.venue_charges
                    WHERE source_type = 'class' AND source_id = p_booking_id::text AND status <> 'refunded') THEN
      INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
      VALUES (v_sess.venue_id, 'class', p_booking_id::text, v_amount, 'unpaid', v_sess.starts_at::date);
    END IF;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public._apply_class_booking_charge(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. member_list_class_sessions ─────────────────────────────────────────────
-- Public weekly timetable. Granted to anon AND authenticated: the session list +
-- spots_left render with no login; my_status / my_waitlist_position only populate
-- when an authenticated caller has a member_profile.

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
           GREATEST(cs.capacity - (SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.status = 'confirmed'), 0)::int AS spots_left,
           (SELECT b.status            FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_status,
           (SELECT b.id                FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_booking_id,
           (SELECT b.waitlist_position FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_waitlist_position
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

-- ── 5. member_book_class_session ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_book_class_session(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   public.member_profiles;
  v_sess      public.venue_class_sessions;
  v_threshold int;
  v_confirmed int;
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
  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed','waitlist') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_booked',
                              'booking_id', v_existing.id, 'status', v_existing.status);
  END IF;

  -- capacity decision
  SELECT count(*) INTO v_confirmed FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND status = 'confirmed';
  IF v_sess.capacity > 0 AND v_confirmed < v_sess.capacity THEN
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
           cancelled_at = NULL, payment_status = 'pending', payment_method = 'not_yet'
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

-- ── 6. member_cancel_class_booking ────────────────────────────────────────────
-- Enforces cancellation_cutoff_hours (confirmed only); refunds any class charge;
-- auto-promotes the next waitlist booking (Phase 4 replaces this with notify-and-
-- claim). Queues a cancellation-confirmation (and a promotion notice) to drain.

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
  v_promoted   uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_bk FROM public.venue_class_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_bk.member_profile_id <> v_profile_id THEN
    RAISE EXCEPTION 'booking_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_bk.status NOT IN ('confirmed','waitlist') THEN
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

  UPDATE public.venue_class_bookings
     SET status = 'cancelled', cancelled_at = now(), waitlist_position = NULL
   WHERE id = p_booking_id;

  -- refund / void any class charge for this booking
  UPDATE public.venue_charges SET status = 'refunded'
   WHERE source_type = 'class' AND source_id = p_booking_id::text AND status <> 'refunded';
  GET DIAGNOSTICS v_refunded = ROW_COUNT;

  -- auto-promote the next waitlist booking (a freed confirmed seat only)
  IF v_was = 'confirmed' AND v_sess.status = 'scheduled' AND v_sess.starts_at > now() THEN
    SELECT id INTO v_promoted FROM public.venue_class_bookings
     WHERE session_id = v_bk.session_id AND status = 'waitlist'
     ORDER BY waitlist_position ASC NULLS LAST, booked_at ASC LIMIT 1;
    IF v_promoted IS NOT NULL THEN
      UPDATE public.venue_class_bookings SET status = 'confirmed', waitlist_position = NULL WHERE id = v_promoted;
      PERFORM public._apply_class_booking_charge(v_promoted);
      INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
      SELECT v_venue_id, b.member_profile_id::text, 'class_waitlist_promoted', b.id::text, mp.email, now(),
             jsonb_build_object('session_id', v_bk.session_id)
        FROM public.venue_class_bookings b
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.id = v_promoted;
    END IF;
  END IF;

  -- cancellation confirmation to the cancelling member
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_venue_id, v_profile_id::text, 'class_booking_cancelled', p_booking_id::text, mp.email, now(),
         jsonb_build_object('session_id', v_bk.session_id)
    FROM public.member_profiles mp WHERE mp.id = v_profile_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, v_uid, 'player', 'member_class_cancelled', 'venue_class_booking', p_booking_id::text,
          jsonb_build_object('session_id', v_bk.session_id, 'was', v_was,
                             'refunded', v_refunded, 'promoted', v_promoted));

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id,
                            'refunded', v_refunded, 'promoted', (v_promoted IS NOT NULL));
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_cancel_class_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_cancel_class_booking(uuid) TO authenticated;

-- ── 7. member_list_my_class_bookings ──────────────────────────────────────────
-- The caller's bookings (optionally scoped to a venue). is_upcoming splits the
-- "Upcoming classes" view from "My class history" client-side.

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
           b.booked_at, b.cancelled_at,
           cs.id AS session_id, cs.venue_id, vn.name AS venue_name, ct.name AS class_name, ct.category,
           cs.space_id, sp.name AS space_name, cs.instructor_id, va.email AS instructor_email,
           cs.starts_at, cs.ends_at, cs.price_pence, cs.status AS session_status,
           ct.cancellation_cutoff_hours,
           (cs.starts_at >= now() AND b.status IN ('confirmed','waitlist')) AS is_upcoming
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

-- Refresh PostgREST's function-signature cache.
SELECT pg_notify('pgrst', 'reload schema');
