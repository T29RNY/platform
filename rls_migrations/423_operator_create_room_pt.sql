-- 423_operator_create_room_pt.sql
-- Calendar & mobile — Phase 2b: operator create-from-calendar for the two lanes
-- that had no operator create path (deferred from resource-calendar Phase 2).
--
-- Today a room hire is member-requested then operator-confirmed (mig 342), and a
-- PT appointment is member-self-booked (mig 358). Neither lets the OPERATOR create
-- a booking directly from the unified resource calendar. This lands two
-- venue-token SECDEF write RPCs, both creating in 'confirmed' status (the operator
-- is the authority — same posture as venue_create_equipment_hire / the pitch
-- walk-in), both auditing per the venue-write convention.
--
-- Clash protection:
--   * Rooms REUSE _space_is_available (mig 338 — overlap vs class sessions ∪ room
--     hires) + a FOR UPDATE lock on the venue_spaces row to close the race window
--     (equipment-hire pattern). No new table; no schema change.
--   * Trainers have only a UNIQUE(trainer_id, starts_at) index (exact-start) which
--     cannot catch an arbitrary-time overlap, so venue_create_appointment inlines
--     an overlap guard against non-cancelled venue_appointments, with the unique
--     index as a belt-and-braces backstop (unique_violation → slot_taken).
--
-- Decisions (operator, s203):
--   * PT appointments = EXISTING MEMBERS ONLY (member_profile_id is NOT NULL on
--     venue_appointments; no walk-in PT in v1). Room hire keeps the existing
--     walk-in shape (booker_type 'non_member' + free-text contact) — no schema change.
--   * Operator create does NOT enforce the trainer availability window (ad-hoc
--     override — the one-off Sunday session); window enforcement stays member-side.

-- ── 1. venue_create_room_hire (venue token) ──────────────────────────────────
-- Operator ad-hoc room hire straight to 'confirmed'. Either a member (pass
-- p_member_profile_id → booker_type 'member', contact pulled from the profile but
-- overridable) or a walk-in (p_booker_name → booker_type 'non_member'). Prices +
-- charges inline like venue_confirm_room_hire. Reuses _space_is_available under a
-- row lock.

CREATE OR REPLACE FUNCTION public.venue_create_room_hire(
  p_venue_token       text,
  p_space_id          uuid,
  p_starts_at         timestamptz,
  p_ends_at           timestamptz,
  p_purpose           text,
  p_price_pence       int     DEFAULT 0,
  p_booker_name       text    DEFAULT NULL,
  p_booker_email      text    DEFAULT NULL,
  p_booker_phone      text    DEFAULT NULL,
  p_deposit_pence     int     DEFAULT NULL,
  p_attendee_count    int     DEFAULT NULL,
  p_member_profile_id uuid    DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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

  -- lock the space row to serialise concurrent operator/member bookings, then
  -- check availability (overlap vs class sessions ∪ room hires on this space)
  SELECT * INTO v_space FROM public.venue_spaces WHERE id = p_space_id FOR UPDATE;
  IF NOT FOUND OR NOT v_space.is_active THEN RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001'; END IF;
  IF v_space.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'space_not_in_venue' USING ERRCODE='P0001'; END IF;
  IF NOT public._space_is_available(p_space_id, p_starts_at, p_ends_at) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'space_unavailable');
  END IF;

  -- booker resolution: member (profile must belong to this venue's reach) or walk-in
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
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_room_hire(text,uuid,timestamptz,timestamptz,text,int,text,text,text,int,int,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_room_hire(text,uuid,timestamptz,timestamptz,text,int,text,text,text,int,int,uuid) TO anon, authenticated;

-- ── 2. venue_create_appointment (venue token) ────────────────────────────────
-- Operator books an EXISTING member into a trainer slot, straight to 'confirmed'.
-- No availability-window enforcement (operator ad-hoc override). Inlined overlap
-- guard (the UNIQUE(trainer_id, starts_at) index only catches an exact-start
-- collision); the unique index remains a backstop. ends defaults to the trainer's
-- default_session_minutes, price to the trainer's price_pence.

CREATE OR REPLACE FUNCTION public.venue_create_appointment(
  p_venue_token       text,
  p_trainer_id        uuid,
  p_member_profile_id uuid,
  p_starts_at         timestamptz,
  p_ends_at           timestamptz DEFAULT NULL,
  p_price_pence       int         DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller    record;
  v_tr        public.venue_trainers;
  v_profile   public.member_profiles;
  v_ends      timestamptz;
  v_price     int;
  v_overlap   int;
  v_appt_id   uuid;
  v_charge_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;

  -- trainer must belong to the caller's venue (lock to serialise concurrent books)
  SELECT * INTO v_tr FROM public.venue_trainers WHERE id = p_trainer_id FOR UPDATE;
  IF v_tr.id IS NULL OR NOT v_tr.active THEN RAISE EXCEPTION 'trainer_not_found' USING ERRCODE='P0001'; END IF;
  IF v_tr.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'trainer_not_in_venue' USING ERRCODE='P0001'; END IF;

  -- existing member required (member_profile_id is NOT NULL on venue_appointments)
  SELECT * INTO v_profile FROM public.member_profiles WHERE id = p_member_profile_id;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'member_not_found' USING ERRCODE='P0001'; END IF;

  IF p_starts_at IS NULL OR p_starts_at <= now() THEN RAISE EXCEPTION 'slot_in_past' USING ERRCODE='P0001'; END IF;
  v_ends  := COALESCE(p_ends_at, p_starts_at + (v_tr.default_session_minutes * INTERVAL '1 minute'));
  IF v_ends <= p_starts_at THEN RAISE EXCEPTION 'bad_time_range' USING ERRCODE='P0001'; END IF;
  v_price := COALESCE(p_price_pence, v_tr.price_pence);
  IF v_price < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;

  -- overlap guard (arbitrary times — the exact-start unique index can't catch this)
  SELECT count(*) INTO v_overlap FROM public.venue_appointments
   WHERE trainer_id = p_trainer_id AND status <> 'cancelled'
     AND starts_at < v_ends AND ends_at > p_starts_at;
  IF v_overlap > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'slot_taken'); END IF;

  BEGIN
    INSERT INTO public.venue_appointments
      (venue_id, trainer_id, member_profile_id, starts_at, ends_at, status, price_pence, payment_mode)
    VALUES
      (v_tr.venue_id, p_trainer_id, p_member_profile_id, p_starts_at, v_ends, 'confirmed', v_price, 'door')
    RETURNING id INTO v_appt_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slot_taken');
  END;

  IF v_price > 0 THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_tr.venue_id, 'pt', v_appt_id::text, v_price, 'unpaid', p_starts_at::date)
    RETURNING id INTO v_charge_id;
    UPDATE public.venue_appointments SET charge_id = v_charge_id WHERE id = v_appt_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_tr.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'appointment_created_by_operator', 'venue_appointment', v_appt_id::text,
          jsonb_build_object('trainer_id', p_trainer_id, 'member_profile_id', p_member_profile_id,
                             'starts_at', p_starts_at, 'ends_at', v_ends, 'price_pence', v_price, 'charge_id', v_charge_id));

  RETURN jsonb_build_object('ok', true, 'appointment_id', v_appt_id, 'status', 'confirmed',
                            'starts_at', p_starts_at, 'ends_at', v_ends, 'price_pence', v_price, 'charge_id', v_charge_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_appointment(text,uuid,uuid,timestamptz,timestamptz,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_appointment(text,uuid,uuid,timestamptz,timestamptz,int) TO anon, authenticated;

-- Refresh PostgREST's function-signature cache.
SELECT pg_notify('pgrst', 'reload schema');
