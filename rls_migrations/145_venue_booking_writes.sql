-- Migration 145 — Pitch Booking Stage 4 (booking-owned): venue-operator writes.
-- All authenticate via resolve_venue_caller(p_venue_token) and validate the
-- target belongs to the caller's venue. Follow the venue_assign_pitch pattern
-- (audit Phase 2 shape + notify both channels + returns jsonb).
--   venue_create_booking  — walk-in/phone, status 'confirmed' directly.
--   venue_confirm_booking — requested -> confirmed (occupancy already held).
--   venue_decline_booking — requested -> declined, frees the slot.
-- Walk-in audit uses team_id = venue_id (Phase 2 convention; team_id NOT NULL).

CREATE OR REPLACE FUNCTION public.venue_create_booking(
  p_venue_token     text,
  p_playing_area_id uuid,
  p_booking_date    date,
  p_kickoff_time    time,
  p_slot_minutes    int  DEFAULT NULL,
  p_team_id         text DEFAULT NULL,
  p_booked_by_name  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_slot int;
  v_start timestamptz;
  v_booking_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_playing_area_id IS NULL OR p_booking_date IS NULL OR p_kickoff_time IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_team_id IS NULL AND NULLIF(trim(COALESCE(p_booked_by_name,'')),'') IS NULL THEN
    RAISE EXCEPTION 'booker_required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  v_slot := COALESCE(p_slot_minutes, 60);
  v_start := (p_booking_date + p_kickoff_time) AT TIME ZONE 'Europe/London';

  INSERT INTO pitch_bookings (id, team_id, booked_by_name, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
  VALUES (v_booking_id, p_team_id, NULLIF(trim(p_booked_by_name),''), v_venue_id, p_playing_area_id, p_booking_date, p_kickoff_time, v_slot, 'adhoc', 'confirmed');

  BEGIN
    INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 3, true);
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(p_team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'pitch_booking', v_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'playing_area_id', p_playing_area_id, 'booking_date', p_booking_date,
                       'kickoff_time', p_kickoff_time, 'slot_minutes', v_slot, 'kind', 'adhoc', 'walk_in', (p_team_id IS NULL),
                       'booked_by_name', NULLIF(trim(p_booked_by_name),'')));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF p_team_id IS NOT NULL THEN PERFORM public.notify_team_change(p_team_id, 'booking_confirmed'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', 'confirmed', 'kind', 'adhoc');
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_create_booking(text, uuid, date, time, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_booking(text, uuid, date, time, int, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.venue_confirm_booking(p_venue_token text, p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_bk record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_bk FROM pitch_bookings WHERE id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.venue_id <> v_venue_id THEN RAISE EXCEPTION 'booking_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.status <> 'requested' THEN RAISE EXCEPTION 'booking_not_pending' USING ERRCODE = 'P0001', DETAIL = v_bk.status; END IF;

  UPDATE pitch_bookings SET status = 'confirmed' WHERE id = p_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'pitch_booking', p_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_confirmed'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'confirmed');
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_confirm_booking(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_confirm_booking(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.venue_decline_booking(p_venue_token text, p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_bk record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_bk FROM pitch_bookings WHERE id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.venue_id <> v_venue_id THEN RAISE EXCEPTION 'booking_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.status <> 'requested' THEN RAISE EXCEPTION 'booking_not_pending' USING ERRCODE = 'P0001', DETAIL = v_bk.status; END IF;

  UPDATE pitch_bookings SET status = 'declined' WHERE id = p_booking_id;
  UPDATE pitch_occupancy SET active = false WHERE source_kind = 'booking' AND source_id = p_booking_id::text;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_declined', 'pitch_booking', p_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_declined');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_declined'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'declined');
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_decline_booking(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_decline_booking(text, uuid) TO anon, authenticated;
