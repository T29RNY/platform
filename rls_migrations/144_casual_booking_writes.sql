-- Migration 144 — Pitch Booking Stage 4 (booking-owned): casual request writes.
-- book_pitch_adhoc / book_pitch_series authenticate via auth.uid() -> team_admins
-- (caller must administer p_team_id; team_id identifies WHICH team, auth.uid()
-- proves authority — never a trust signal). Status 'requested' holds the slot
-- via a pitch_occupancy row (priority 2 block / 3 ad-hoc). The partial EXCLUDE
-- rejects a taken slot -> friendly 'slot_unavailable'. Audit (Phase 2 shape) +
-- notify both channels 'booking_requested'. authenticated-only (REVOKE anon).
-- Out-of-hours guard is the human confirm step (venue approves every request).

CREATE OR REPLACE FUNCTION public.book_pitch_adhoc(
  p_team_id         text,
  p_playing_area_id uuid,
  p_booking_date    date,
  p_kickoff_time    time,
  p_slot_minutes    int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue_id text;
  v_slot int;
  v_start timestamptz;
  v_booking_id uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NULL OR p_playing_area_id IS NULL OR p_booking_date IS NULL OR p_kickoff_time IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = p_team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not_team_admin' USING ERRCODE = 'P0001';
  END IF;

  SELECT pa.venue_id INTO v_venue_id
  FROM playing_areas pa JOIN venues v ON v.id = pa.venue_id
  WHERE pa.id = p_playing_area_id AND pa.active AND pa.is_available
    AND v.bookings_enabled AND v.active;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'pitch_unavailable' USING ERRCODE = 'P0001', DETAIL = p_playing_area_id::text;
  END IF;

  v_slot := COALESCE(p_slot_minutes, 60);
  v_start := (p_booking_date + p_kickoff_time) AT TIME ZONE 'Europe/London';

  INSERT INTO pitch_bookings (id, team_id, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
  VALUES (v_booking_id, p_team_id, v_venue_id, p_playing_area_id, p_booking_date, p_kickoff_time, v_slot, 'adhoc', 'requested');

  BEGIN
    INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 3, true);
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (p_team_id, v_uid, 'team_admin', 'user_id:' || v_uid::text, 'booking_requested', 'pitch_booking', v_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'playing_area_id', p_playing_area_id, 'booking_date', p_booking_date,
                       'kickoff_time', p_kickoff_time, 'slot_minutes', v_slot, 'kind', 'adhoc'));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_requested');
  PERFORM public.notify_team_change(p_team_id, 'booking_requested');

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', 'requested', 'kind', 'adhoc');
END;
$function$;
REVOKE ALL ON FUNCTION public.book_pitch_adhoc(text, uuid, date, time, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_pitch_adhoc(text, uuid, date, time, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.book_pitch_series(
  p_team_id         text,
  p_playing_area_id uuid,
  p_kickoff_time    time,
  p_start_date      date,
  p_weeks           int,
  p_slot_minutes    int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue_id text;
  v_slot int;
  v_dow smallint;
  v_series_id uuid := gen_random_uuid();
  v_i int;
  v_date date;
  v_start timestamptz;
  v_booking_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NULL OR p_playing_area_id IS NULL OR p_kickoff_time IS NULL OR p_start_date IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_weeks IS NULL OR p_weeks < 1 OR p_weeks > 52 THEN
    RAISE EXCEPTION 'weeks_out_of_range' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = p_team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not_team_admin' USING ERRCODE = 'P0001';
  END IF;

  SELECT pa.venue_id INTO v_venue_id
  FROM playing_areas pa JOIN venues v ON v.id = pa.venue_id
  WHERE pa.id = p_playing_area_id AND pa.active AND pa.is_available
    AND v.bookings_enabled AND v.active;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'pitch_unavailable' USING ERRCODE = 'P0001', DETAIL = p_playing_area_id::text;
  END IF;

  v_slot := COALESCE(p_slot_minutes, 60);
  v_dow  := EXTRACT(DOW FROM p_start_date)::smallint;

  INSERT INTO booking_series (id, team_id, venue_id, playing_area_id, day_of_week, kickoff_time, slot_minutes, status, ends_on)
  VALUES (v_series_id, p_team_id, v_venue_id, p_playing_area_id, v_dow, p_kickoff_time, v_slot, 'active', p_start_date + (p_weeks - 1) * 7);

  BEGIN
    FOR v_i IN 0 .. (p_weeks - 1) LOOP
      v_date := p_start_date + v_i * 7;
      v_start := (v_date + p_kickoff_time) AT TIME ZONE 'Europe/London';
      v_booking_id := gen_random_uuid();
      INSERT INTO pitch_bookings (id, team_id, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status, series_id)
      VALUES (v_booking_id, p_team_id, v_venue_id, p_playing_area_id, v_date, p_kickoff_time, v_slot, 'block', 'requested', v_series_id);
      INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
      VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 2, true);
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001', DETAIL = v_date::text;
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (p_team_id, v_uid, 'team_admin', 'user_id:' || v_uid::text, 'booking_requested', 'booking_series', v_series_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'playing_area_id', p_playing_area_id, 'day_of_week', v_dow,
                       'kickoff_time', p_kickoff_time, 'slot_minutes', v_slot, 'weeks', p_weeks, 'start_date', p_start_date, 'kind', 'block'));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_requested');
  PERFORM public.notify_team_change(p_team_id, 'booking_requested');

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'weeks', p_weeks, 'status', 'requested', 'kind', 'block');
END;
$function$;
REVOKE ALL ON FUNCTION public.book_pitch_series(text, uuid, time, date, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_pitch_series(text, uuid, time, date, int, int) TO authenticated;
