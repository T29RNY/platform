-- 342_room_hire.sql
-- Classes Booking + Room Hire — Phase 5: Room hire.
--
-- Lands venue_room_hires (the booking entity for hiring a venue_spaces space for a
-- private session / function), the equipment_bookings.room_hire_id add-on link, the
-- venue_charges 'room_hire' source_type, and 8 RPCs (6 plan write/list RPCs + 2
-- public read RPCs the member surface requires).
--
-- Landing venue_room_hires ACTIVATES the room-hire arm of _space_is_available
-- (mig 338) automatically — the to_regclass guard begins counting room hires; no
-- recreate needed. member_request_room_hire calls it to block self-serve overlaps.
--
-- public_enquire_room_hire is the FIRST anon WRITE in this epic. It is restricted to
-- is_enquiry_only spaces, creates no charge, caps all text inputs, throttles repeat
-- enquiries per email+space, audits every call as actor_type='system' (the anon-safe
-- value — auth.uid() is NULL), and returns only { ok, hire_id }.

-- ── 1. venue_room_hires ──────────────────────────────────────────────────────
-- venue_id is denormalized (not just space_id) — needed for venue_charges.venue_id,
-- audit team_id, and venue-scoped listing; same pattern as venue_class_sessions.

CREATE TABLE IF NOT EXISTS public.venue_room_hires (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          text        NOT NULL REFERENCES public.venues(id)        ON DELETE CASCADE,
  space_id          uuid        NOT NULL REFERENCES public.venue_spaces(id)   ON DELETE CASCADE,
  booker_type       text        NOT NULL CHECK (booker_type IN ('member','non_member')),
  member_profile_id uuid        REFERENCES public.member_profiles(id)         ON DELETE SET NULL,
  booker_name       text,
  booker_email      text,
  booker_phone      text,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  purpose           text        NOT NULL,
  attendee_count    int         CHECK (attendee_count IS NULL OR attendee_count >= 0),
  status            text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','cancelled')),
  price_pence       int         CHECK (price_pence IS NULL OR price_pence >= 0),
  deposit_pence     int         CHECK (deposit_pence IS NULL OR deposit_pence >= 0),
  deposit_status    text        NOT NULL DEFAULT 'none' CHECK (deposit_status IN ('none','held','returned','forfeited')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS venue_room_hires_venue_idx  ON public.venue_room_hires (venue_id);
CREATE INDEX IF NOT EXISTS venue_room_hires_space_idx  ON public.venue_room_hires (space_id);
CREATE INDEX IF NOT EXISTS venue_room_hires_status_idx ON public.venue_room_hires (status);
CREATE INDEX IF NOT EXISTS venue_room_hires_member_idx ON public.venue_room_hires (member_profile_id);

-- Writes/reads only through the SECURITY DEFINER RPCs below. No direct client access.
ALTER TABLE public.venue_room_hires ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_room_hires FROM PUBLIC, anon, authenticated;

-- ── 2. equipment_bookings.room_hire_id (additive) ────────────────────────────
ALTER TABLE public.equipment_bookings
  ADD COLUMN IF NOT EXISTS room_hire_id uuid REFERENCES public.venue_room_hires(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS equipment_bookings_room_hire_idx ON public.equipment_bookings (room_hire_id);

-- ── 3. venue_charges source_type += 'room_hire' ──────────────────────────────
ALTER TABLE public.venue_charges DROP CONSTRAINT IF EXISTS venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership','merchandise','class','room_hire']));

-- ── 4. member_request_room_hire (authenticated) ──────────────────────────────
-- Self-serve hire request by a logged-in member. Calls _space_is_available
-- (rejects overlaps with class sessions / other live hires). Creates 'requested';
-- links optional equipment add-ons as 'requested' equipment_bookings rows (no charge
-- — the venue prices + charges on confirm). Caps open requests per member+space.

CREATE OR REPLACE FUNCTION public.member_request_room_hire(
  p_space_id       uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_purpose        text,
  p_attendee_count int     DEFAULT NULL,
  p_equipment_ids  uuid[]  DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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

  -- optional equipment add-ons (only kit belonging to this venue), recorded as
  -- 'requested' — the venue prices/charges these on confirm.
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

  -- acknowledge the request to the booker (drained by roomHireNotificationsJob)
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
$fn$;
REVOKE ALL ON FUNCTION public.member_request_room_hire(uuid,timestamptz,timestamptz,text,int,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_request_room_hire(uuid,timestamptz,timestamptz,text,int,uuid[]) TO authenticated;

-- ── 5. public_enquire_room_hire (ANON) ───────────────────────────────────────
-- The first anon write in this epic. enquiry-only spaces ONLY; no charge; length
-- caps; per-email+space throttle; audited as actor_type='system' (auth.uid() NULL).

CREATE OR REPLACE FUNCTION public.public_enquire_room_hire(
  p_space_id       uuid,
  p_name           text,
  p_email          text,
  p_phone          text,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_purpose        text,
  p_attendee_count int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_space   public.venue_spaces;
  v_recent  int;
  v_hire_id uuid;
BEGIN
  SELECT * INTO v_space FROM public.venue_spaces WHERE id = p_space_id;
  IF NOT FOUND OR NOT v_space.is_active THEN RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT v_space.is_enquiry_only THEN RAISE EXCEPTION 'not_enquiry_only' USING ERRCODE='P0001'; END IF;

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

  -- abuse throttle: at most 3 enquiries from this email for this space in 10 min
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
$fn$;
REVOKE ALL ON FUNCTION public.public_enquire_room_hire(uuid,text,text,text,timestamptz,timestamptz,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_enquire_room_hire(uuid,text,text,text,timestamptz,timestamptz,text,int) TO anon, authenticated;

-- ── 6. venue_list_room_hires (venue token) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_room_hires(p_venue_token text, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)
           ORDER BY (x.status = 'requested') DESC, x.starts_at), '[]'::jsonb) INTO v_result FROM (
    SELECT h.id, h.venue_id, h.space_id, sp.name AS space_name, sp.space_type,
           h.booker_type, h.member_profile_id, h.booker_name, h.booker_email, h.booker_phone,
           h.starts_at, h.ends_at, h.purpose, h.attendee_count, h.status,
           h.price_pence, h.deposit_pence, h.deposit_status, h.notes, h.created_at,
           (SELECT vc.status FROM public.venue_charges vc
             WHERE vc.source_type = 'room_hire' AND vc.source_id = h.id::text
             ORDER BY vc.created_at DESC LIMIT 1) AS charge_status,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('booking_id', eb.id, 'equipment_id', eb.equipment_id,
                                                         'name', e.name, 'qty', eb.qty, 'status', eb.status)
                                      ORDER BY e.name)
                       FROM public.equipment_bookings eb
                       JOIN public.equipment e ON e.id = eb.equipment_id
                      WHERE eb.room_hire_id = h.id), '[]'::jsonb) AS equipment
      FROM public.venue_room_hires h
      JOIN public.venue_spaces sp ON sp.id = h.space_id
     WHERE h.venue_id = v_caller.venue_id
       AND (p_status IS NULL OR h.status = p_status)
  ) x;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_room_hires(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_room_hires(text,text) TO anon, authenticated;

-- ── 7. venue_confirm_room_hire (venue token) ─────────────────────────────────
-- requested → confirmed; prices it; creates a venue_charges 'room_hire' row (if
-- price > 0); confirms linked equipment add-ons; notifies the booker.

CREATE OR REPLACE FUNCTION public.venue_confirm_room_hire(
  p_venue_token text,
  p_hire_id     uuid,
  p_price_pence int,
  p_deposit_pence int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
  IF v_hire.status <> 'requested' THEN RAISE EXCEPTION 'not_confirmable' USING ERRCODE='P0001'; END IF;
  IF p_price_pence IS NULL OR p_price_pence < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF p_deposit_pence IS NOT NULL AND p_deposit_pence < 0 THEN RAISE EXCEPTION 'bad_deposit' USING ERRCODE='P0001'; END IF;

  UPDATE public.venue_room_hires
     SET status = 'confirmed', price_pence = p_price_pence, deposit_pence = p_deposit_pence
   WHERE id = p_hire_id;

  -- charge for the hire fee (deposit is tracked separately on the row)
  IF p_price_pence > 0
     AND NOT EXISTS (SELECT 1 FROM public.venue_charges
                      WHERE source_type = 'room_hire' AND source_id = p_hire_id::text AND status <> 'refunded') THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_hire.venue_id, 'room_hire', p_hire_id::text, p_price_pence, 'unpaid', v_hire.starts_at::date)
    RETURNING id INTO v_charge_id;
  END IF;

  -- confirm any linked equipment add-ons
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
$fn$;
REVOKE ALL ON FUNCTION public.venue_confirm_room_hire(text,uuid,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_confirm_room_hire(text,uuid,int,int) TO anon, authenticated;

-- ── 8. venue_cancel_room_hire (venue token) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_cancel_room_hire(
  p_venue_token text,
  p_hire_id     uuid,
  p_reason      text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
  IF v_hire.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  -- a held deposit is returned on cancellation
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
$fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_room_hire(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_room_hire(text,uuid,text) TO anon, authenticated;

-- ── 9. venue_record_hire_deposit (venue token) ───────────────────────────────
-- Transition the deposit lifecycle (none/held/returned/forfeited). Row-tracked,
-- no separate ledger row — same posture as equipment-hire deposits.

CREATE OR REPLACE FUNCTION public.venue_record_hire_deposit(
  p_venue_token   text,
  p_hire_id       uuid,
  p_deposit_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_hire public.venue_room_hires;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  IF p_deposit_status NOT IN ('none','held','returned','forfeited') THEN
    RAISE EXCEPTION 'bad_deposit_status' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_hire FROM public.venue_room_hires WHERE id = p_hire_id;
  IF NOT FOUND OR v_hire.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'hire_not_found' USING ERRCODE='P0001';
  END IF;

  UPDATE public.venue_room_hires SET deposit_status = p_deposit_status WHERE id = p_hire_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_hire.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'room_hire_deposit_recorded', 'venue_room_hire', p_hire_id::text,
          jsonb_build_object('deposit_status', p_deposit_status));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'deposit_status', p_deposit_status);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_record_hire_deposit(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_record_hire_deposit(text,uuid,text) TO anon, authenticated;

-- ── 10. member_list_hireable_spaces (public read — anon + authenticated) ─────
-- Powers the "Hire a space" cards on VenueLanding. Active spaces only, with the
-- booking model (is_enquiry_only) + enquiry contact for the contact-form path.

CREATE OR REPLACE FUNCTION public.member_list_hireable_spaces(p_venue_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.name), '[]'::jsonb) INTO v_result FROM (
    SELECT s.id AS space_id, s.name, s.description, s.capacity, s.space_type,
           s.is_enquiry_only, s.enquiry_contact_name, s.enquiry_contact_email
      FROM public.venue_spaces s
     WHERE s.venue_id = p_venue_id AND s.is_active = true
  ) x;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_list_hireable_spaces(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_list_hireable_spaces(text) TO anon, authenticated;

-- ── 11. member_list_my_room_hires (authenticated read) ───────────────────────
CREATE OR REPLACE FUNCTION public.member_list_my_room_hires(p_venue_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.starts_at DESC), '[]'::jsonb) INTO v_result FROM (
    SELECT h.id AS hire_id, h.venue_id, vn.name AS venue_name, h.space_id, sp.name AS space_name,
           h.starts_at, h.ends_at, h.purpose, h.attendee_count, h.status,
           h.price_pence, h.deposit_pence, h.deposit_status, h.created_at,
           (h.starts_at >= now() AND h.status <> 'cancelled') AS is_upcoming
      FROM public.venue_room_hires h
      JOIN public.venue_spaces sp ON sp.id = h.space_id
      JOIN public.venues vn ON vn.id = h.venue_id
     WHERE h.member_profile_id = v_profile_id
       AND (p_venue_id IS NULL OR h.venue_id = p_venue_id)
  ) x;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_list_my_room_hires(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_list_my_room_hires(text) TO authenticated;

-- Refresh PostgREST's function-signature cache.
SELECT pg_notify('pgrst', 'reload schema');
