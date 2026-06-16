-- 344_class_packages.sql
--
-- Classes Booking + Room Hire — Phase 7: Class packages & trial classes.
--
-- A "class pass" = a prepaid bundle of N class sessions (e.g. "10 classes for £80",
-- optionally expiring after valid_days). A member buys a pass; each subsequent
-- class booking burns one credit instead of raising a per-class charge.
--
-- Lands:
--   • venue_class_packages            — the venue's purchasable passes.
--   • venue_member_package_balances   — one row per purchase; sessions_remaining
--                                       decremented as the member books.
--   • venue_class_bookings.package_balance_id — links a booking to the credit it
--                                       burned (so cancel-within-cutoff can restore).
--   • venue_charges.source_type += 'class_package'.
--   • 5 RPCs: venue create/list packages; member list (public menu) / purchase /
--     get-balance.
--   • _apply_class_booking_charge re-issued with a PACKAGE branch (waiver > package
--     > charge precedence). This is the single charge-decision source shared by
--     book / claim / waitlist-promote, so putting the deduction here (not in
--     member_book_class_session) keeps all three paths consistent.
--   • member_cancel_class_booking re-issued: restore a burned credit on cancel.
--   • venue_cancel_class_session / _series re-issued: restore burned credits when a
--     venue cancels (must not strand member money — same principle as the charge
--     refund cascade they already run). Return shapes unchanged (Hard Rule #7).
--
-- PURCHASE is NOT Stripe-gated: like memberships (mig 271) and merchandise
-- (mig 309), buying a pass raises an 'unpaid' venue_charges row and grants the
-- balance immediately; payment is collected via the existing venue_charges flow
-- (reception/door today, Stripe once connected). Gating behind Stripe would make
-- passes unsellable for door-payment venues.
--
-- WAIVER PRECEDENCE: a session that is already free for the member (tier
-- included_sessions>0, first_session_free-first-at-venue, or £0 base) does NOT burn
-- a paid credit — the member keeps it. A package credit is consumed only when a real
-- charge would otherwise apply. A no-show forfeits the credit (no restore — mirrors
-- prepaid). All member RPCs: SECURITY DEFINER, search_path pinned, auth via
-- auth.uid(), audited actor_type='player' (the mig-297/335 constraint trap).

-- ── 1. venue_class_packages ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_class_packages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  session_count int         NOT NULL CHECK (session_count > 0),
  price_pence   int         NOT NULL CHECK (price_pence >= 0),
  valid_days    int         CHECK (valid_days IS NULL OR valid_days > 0),
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_class_packages_venue_idx ON public.venue_class_packages (venue_id);

ALTER TABLE public.venue_class_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_class_packages FROM PUBLIC, anon, authenticated;

-- ── 2. venue_member_package_balances ──────────────────────────────────────────
-- venue_id denormalized (same pattern as venue_class_sessions / venue_room_hires)
-- so the booking-charge helper can match a member's balance to a session's venue
-- without re-joining through the package row.

CREATE TABLE IF NOT EXISTS public.venue_member_package_balances (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_profile_id uuid        NOT NULL REFERENCES public.member_profiles(id)      ON DELETE CASCADE,
  package_id        uuid        NOT NULL REFERENCES public.venue_class_packages(id) ON DELETE RESTRICT,
  venue_id          text        NOT NULL REFERENCES public.venues(id)               ON DELETE CASCADE,
  sessions_remaining int        NOT NULL CHECK (sessions_remaining >= 0),
  purchased_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz
);
CREATE INDEX IF NOT EXISTS vmpb_member_venue_idx ON public.venue_member_package_balances (member_profile_id, venue_id);

ALTER TABLE public.venue_member_package_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_member_package_balances FROM PUBLIC, anon, authenticated;

-- ── 3. booking → balance link (additive) ──────────────────────────────────────

ALTER TABLE public.venue_class_bookings
  ADD COLUMN IF NOT EXISTS package_balance_id uuid
    REFERENCES public.venue_member_package_balances(id) ON DELETE SET NULL;

-- ── 4. venue_charges source_type += 'class_package' ───────────────────────────

ALTER TABLE public.venue_charges DROP CONSTRAINT IF EXISTS venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership',
                                  'merchandise','class','room_hire','class_package']));

-- ── 5. venue_create_class_package (venue admin token) ─────────────────────────

CREATE OR REPLACE FUNCTION public.venue_create_class_package(
  p_venue_token   text,
  p_name          text,
  p_session_count int,
  p_price_pence   int,
  p_valid_days    int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_session_count IS NULL OR p_session_count <= 0 THEN
    RAISE EXCEPTION 'bad_session_count' USING ERRCODE = 'P0001';
  END IF;
  IF p_price_pence IS NULL OR p_price_pence < 0 THEN
    RAISE EXCEPTION 'bad_price' USING ERRCODE = 'P0001';
  END IF;
  IF p_valid_days IS NOT NULL AND p_valid_days <= 0 THEN
    RAISE EXCEPTION 'bad_valid_days' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_class_packages (venue_id, name, session_count, price_pence, valid_days)
  VALUES (v_caller.venue_id, btrim(p_name), p_session_count, p_price_pence, p_valid_days)
  RETURNING id INTO v_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES
    (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
     'venue_class_package_created', 'venue_class_package', v_id::text,
     jsonb_build_object('venue_id', v_caller.venue_id, 'name', btrim(p_name),
                        'session_count', p_session_count, 'price_pence', p_price_pence,
                        'valid_days', p_valid_days));

  RETURN jsonb_build_object('ok', true, 'package_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_class_package(text,text,int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_class_package(text,text,int,int,int) TO anon, authenticated;

-- ── 6. venue_list_class_packages (venue admin token) ──────────────────────────
-- Each package + nested `balances` array of ACTIVE outstanding member balances
-- (sessions_remaining>0 AND not expired) for the per-member-balances UI.

CREATE OR REPLACE FUNCTION public.venue_list_class_packages(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.is_active DESC, x.created_at DESC), '[]'::jsonb)
    INTO v_result FROM (
    SELECT p.id, p.venue_id, p.name, p.session_count, p.price_pence, p.valid_days,
           p.is_active, p.created_at,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'balance_id', bal.id,
                     'member_profile_id', bal.member_profile_id,
                     'member_name', btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')),
                     'member_email', mp.email,
                     'sessions_remaining', bal.sessions_remaining,
                     'purchased_at', bal.purchased_at,
                     'expires_at', bal.expires_at) ORDER BY bal.purchased_at DESC), '[]'::jsonb)
              FROM public.venue_member_package_balances bal
              JOIN public.member_profiles mp ON mp.id = bal.member_profile_id
             WHERE bal.package_id = p.id
               AND bal.sessions_remaining > 0
               AND (bal.expires_at IS NULL OR bal.expires_at > now())) AS balances
    FROM public.venue_class_packages p
    WHERE p.venue_id = v_caller.venue_id
  ) x;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_class_packages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_class_packages(text) TO anon, authenticated;

-- ── 7. member_list_class_packages (public menu) ───────────────────────────────
-- Active packages for a venue, readable without login (mirrors the public
-- timetable). Drives the "Buy a class pass" sheet; purchase itself is auth-gated.

CREATE OR REPLACE FUNCTION public.member_list_class_packages(p_venue_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.price_pence), '[]'::jsonb) INTO v_result FROM (
    SELECT p.id, p.venue_id, p.name, p.session_count, p.price_pence, p.valid_days
    FROM public.venue_class_packages p
    WHERE p.venue_id = p_venue_id AND p.is_active = true
  ) x;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_list_class_packages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_list_class_packages(text) TO anon, authenticated;

-- ── 8. member_purchase_class_package (authenticated) ──────────────────────────
-- Creates a balance row + an 'unpaid' class_package venue_charges row, granting the
-- credits immediately. Requires active membership (classes are member-only).

CREATE OR REPLACE FUNCTION public.member_purchase_class_package(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_pkg        public.venue_class_packages;
  v_expires    timestamptz;
  v_balance_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_pkg FROM public.venue_class_packages WHERE id = p_package_id;
  IF NOT FOUND OR v_pkg.is_active = false THEN
    RAISE EXCEPTION 'package_not_found' USING ERRCODE='P0001';
  END IF;

  -- member-only: must hold an active membership at the package's venue
  IF NOT EXISTS (SELECT 1 FROM public.venue_memberships
                  WHERE member_profile_id = v_profile_id AND venue_id = v_pkg.venue_id
                    AND status IN ('active','ending')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'membership_required');
  END IF;

  IF v_pkg.valid_days IS NOT NULL THEN
    v_expires := now() + (v_pkg.valid_days * INTERVAL '1 day');
  END IF;

  INSERT INTO public.venue_member_package_balances
    (member_profile_id, package_id, venue_id, sessions_remaining, purchased_at, expires_at)
  VALUES (v_profile_id, v_pkg.id, v_pkg.venue_id, v_pkg.session_count, now(), v_expires)
  RETURNING id INTO v_balance_id;

  -- raise the charge (unpaid; collected door/reception now, Stripe once connected)
  IF v_pkg.price_pence > 0 THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_pkg.venue_id, 'class_package', v_balance_id::text, v_pkg.price_pence, 'unpaid', now()::date);
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_pkg.venue_id, v_uid, 'player', 'member_class_package_purchased', 'venue_member_package_balance',
          v_balance_id::text,
          jsonb_build_object('package_id', v_pkg.id, 'member_profile_id', v_profile_id,
                             'sessions', v_pkg.session_count, 'price_pence', v_pkg.price_pence,
                             'expires_at', v_expires));

  RETURN jsonb_build_object('ok', true, 'balance_id', v_balance_id, 'package_id', v_pkg.id,
                            'sessions_remaining', v_pkg.session_count, 'expires_at', v_expires,
                            'charge_pence', v_pkg.price_pence);
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_purchase_class_package(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_purchase_class_package(uuid) TO authenticated;

-- ── 9. member_get_package_balance (authenticated read) ────────────────────────
-- NULL venue = all venues (for the member pass); a venue id scopes to one (for the
-- timetable). Returns the caller's active (unexpired, non-empty) balances.

CREATE OR REPLACE FUNCTION public.member_get_package_balance(p_venue_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.expires_at NULLS LAST, x.purchased_at), '[]'::jsonb)
    INTO v_result FROM (
    SELECT bal.id AS balance_id, bal.venue_id, vn.name AS venue_name,
           bal.package_id, p.name AS package_name, p.session_count,
           bal.sessions_remaining, bal.purchased_at, bal.expires_at
    FROM public.venue_member_package_balances bal
    JOIN public.venue_class_packages p ON p.id = bal.package_id
    JOIN public.venues vn ON vn.id = bal.venue_id
    WHERE bal.member_profile_id = v_profile_id
      AND bal.sessions_remaining > 0
      AND (bal.expires_at IS NULL OR bal.expires_at > now())
      AND (p_venue_id IS NULL OR bal.venue_id = p_venue_id)
  ) x;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_get_package_balance(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_get_package_balance(text) TO authenticated;

-- ── 10. _apply_class_booking_charge — re-issue with PACKAGE branch ────────────
-- Waiver > package > charge. Single source called by book/claim/promote, so all
-- three burn a credit consistently. A waived booking never burns a paid credit.

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
  v_balance_id uuid;
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

  -- 1) WAIVED wins — never burn a paid credit on a free session.
  IF v_waived THEN
    UPDATE public.venue_class_bookings
       SET payment_status = 'waived', payment_method = 'not_yet', package_balance_id = NULL
     WHERE id = p_booking_id;
    RETURN;
  END IF;

  -- 2) PACKAGE — burn one credit from a valid balance (soonest-expiring first).
  SELECT bal.id INTO v_balance_id
    FROM public.venue_member_package_balances bal
   WHERE bal.member_profile_id = v_bk.member_profile_id
     AND bal.venue_id = v_sess.venue_id
     AND bal.sessions_remaining > 0
     AND (bal.expires_at IS NULL OR bal.expires_at > now())
   ORDER BY bal.expires_at NULLS LAST, bal.purchased_at ASC
   FOR UPDATE
   LIMIT 1;

  IF v_balance_id IS NOT NULL THEN
    UPDATE public.venue_member_package_balances
       SET sessions_remaining = sessions_remaining - 1
     WHERE id = v_balance_id;
    UPDATE public.venue_class_bookings
       SET payment_status = 'paid', payment_method = 'prepay', package_balance_id = v_balance_id
     WHERE id = p_booking_id;
    RETURN;
  END IF;

  -- 3) CHARGE — normal per-class charge (door / prepay).
  UPDATE public.venue_class_bookings
     SET payment_status = 'pending', payment_method = v_method, package_balance_id = NULL
   WHERE id = p_booking_id;
  IF NOT EXISTS (SELECT 1 FROM public.venue_charges
                  WHERE source_type = 'class' AND source_id = p_booking_id::text AND status <> 'refunded') THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_sess.venue_id, 'class', p_booking_id::text, v_amount, 'unpaid', v_sess.starts_at::date);
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public._apply_class_booking_charge(uuid) FROM PUBLIC, anon, authenticated;

-- ── 11. member_cancel_class_booking — re-issue: restore a burned credit ───────
-- Same as mig 341, plus: on cancel, if the booking burned a package credit, give
-- it back (and clear the link). A no-show never reaches here, so forfeit holds.

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
  v_credit_restored boolean := false;
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

  -- restore a burned package credit (if any) before clearing the link
  IF v_bk.package_balance_id IS NOT NULL THEN
    UPDATE public.venue_member_package_balances
       SET sessions_remaining = sessions_remaining + 1
     WHERE id = v_bk.package_balance_id;
    v_credit_restored := true;
  END IF;

  UPDATE public.venue_class_bookings
     SET status = 'cancelled', cancelled_at = now(), waitlist_position = NULL,
         offer_expires_at = NULL, package_balance_id = NULL
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
                             'refunded', v_refunded, 'offered', v_offered,
                             'credit_restored', v_credit_restored));

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id,
                            'refunded', v_refunded, 'offered', (v_offered IS NOT NULL),
                            'credit_restored', v_credit_restored);
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_cancel_class_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_cancel_class_booking(uuid) TO authenticated;

-- ── 12. venue_cancel_class_session — re-issue: restore burned credits ─────────
-- venue_class_bookings now exists permanently (Phase 3), so the cascade is static.
-- Added: restore package credits for every booking of the session that burned one,
-- before the bookings are cancelled (a venue cancel must not strand member money).

CREATE OR REPLACE FUNCTION public.venue_cancel_class_session(
  p_venue_token text,
  p_session_id  uuid,
  p_reason      text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_sess public.venue_class_sessions; v_refunded int := 0; v_notified int := 0; v_credits int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'session_id', p_session_id);
  END IF;

  UPDATE public.venue_class_sessions SET status = 'cancelled', cancellation_reason = p_reason WHERE id = p_session_id;

  -- refund per-class charges
  UPDATE public.venue_charges c SET status = 'refunded'
   WHERE c.source_type = 'class' AND c.status <> 'refunded'
     AND c.source_id IN (SELECT b.id::text FROM public.venue_class_bookings b WHERE b.session_id = p_session_id);
  GET DIAGNOSTICS v_refunded = ROW_COUNT;

  -- restore burned package credits for bookings about to be cancelled
  UPDATE public.venue_member_package_balances bal
     SET sessions_remaining = sessions_remaining + 1
    FROM public.venue_class_bookings b
   WHERE b.session_id = p_session_id
     AND b.status IN ('confirmed','waitlist','offered')
     AND b.package_balance_id = bal.id;
  GET DIAGNOSTICS v_credits = ROW_COUNT;

  UPDATE public.venue_class_bookings b SET status = 'cancelled', cancelled_at = now(), package_balance_id = NULL
   WHERE b.session_id = p_session_id AND b.status IN ('confirmed','waitlist','offered');
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_caller.venue_id, b.member_profile_id::text, 'class_cancelled', p_session_id::text, mp.email, now(),
         jsonb_build_object('reason', p_reason)
    FROM public.venue_class_bookings b
    JOIN public.member_profiles mp ON mp.id = b.member_profile_id
   WHERE b.session_id = p_session_id AND b.status = 'cancelled';

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_session_cancelled', 'venue_class_session', p_session_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason,
                             'refunded', v_refunded, 'notified', v_notified, 'credits_restored', v_credits));

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'refunded', v_refunded, 'notified', v_notified);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_class_session(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_class_session(text,uuid,text) TO anon, authenticated;

-- ── 13. venue_cancel_class_series — re-issue: restore burned credits ──────────

CREATE OR REPLACE FUNCTION public.venue_cancel_class_series(
  p_venue_token text,
  p_series_id   uuid,
  p_reason      text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_cancelled int := 0; v_refunded int := 0; v_credits int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT ct.venue_id INTO v_venue_id
  FROM public.venue_class_series s
  JOIN public.venue_class_types ct ON ct.id = s.class_type_id
  WHERE s.id = p_series_id;
  IF v_venue_id IS NULL OR v_venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE='P0001'; END IF;

  -- refund per-class charges of the soon-to-be-cancelled future sessions
  UPDATE public.venue_charges c SET status = 'refunded'
   WHERE c.source_type = 'class' AND c.status <> 'refunded'
     AND c.source_id IN (
       SELECT b.id::text FROM public.venue_class_bookings b
       JOIN public.venue_class_sessions cs ON cs.id = b.session_id
       WHERE cs.series_id = p_series_id AND cs.status = 'scheduled' AND cs.starts_at > now());
  GET DIAGNOSTICS v_refunded = ROW_COUNT;

  -- restore burned package credits for those bookings
  UPDATE public.venue_member_package_balances bal
     SET sessions_remaining = sessions_remaining + 1
    FROM public.venue_class_bookings b
    JOIN public.venue_class_sessions cs ON cs.id = b.session_id
   WHERE cs.series_id = p_series_id AND cs.status = 'scheduled' AND cs.starts_at > now()
     AND b.status IN ('confirmed','waitlist','offered')
     AND b.package_balance_id = bal.id;
  GET DIAGNOSTICS v_credits = ROW_COUNT;

  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_caller.venue_id, b.member_profile_id::text, 'class_cancelled', cs.id::text, mp.email, now(),
         jsonb_build_object('reason', p_reason, 'series_id', p_series_id)
    FROM public.venue_class_bookings b
    JOIN public.venue_class_sessions cs ON cs.id = b.session_id
    JOIN public.member_profiles mp ON mp.id = b.member_profile_id
   WHERE cs.series_id = p_series_id AND cs.status = 'scheduled' AND cs.starts_at > now()
     AND b.status IN ('confirmed','waitlist','offered');

  UPDATE public.venue_class_bookings b SET status = 'cancelled', cancelled_at = now(), package_balance_id = NULL
   WHERE b.status IN ('confirmed','waitlist','offered')
     AND b.session_id IN (
       SELECT cs.id FROM public.venue_class_sessions cs
       WHERE cs.series_id = p_series_id AND cs.status = 'scheduled' AND cs.starts_at > now());

  UPDATE public.venue_class_sessions SET status = 'cancelled', cancellation_reason = p_reason
   WHERE series_id = p_series_id AND status = 'scheduled' AND starts_at > now();
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE public.venue_class_series SET is_active = false WHERE id = p_series_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_series_cancelled', 'venue_class_series', p_series_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason,
                             'sessions_cancelled', v_cancelled, 'refunded', v_refunded, 'credits_restored', v_credits));

  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id,
                            'sessions_cancelled', v_cancelled, 'refunded', v_refunded);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_class_series(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_class_series(text,uuid,text) TO anon, authenticated;

-- Refresh PostgREST's function-signature cache.
SELECT pg_notify('pgrst', 'reload schema');
