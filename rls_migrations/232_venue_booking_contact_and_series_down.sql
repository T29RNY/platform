-- Down migration 232. Restores venue_create_booking to its mig-145 (7-arg) form and
-- drops the series RPC + helper. Contact columns are left in place (additive, nullable —
-- dropping them would lose data on any bookings created after 232).

DROP FUNCTION IF EXISTS public.venue_create_booking_series(text, uuid, time, date, int, text, int, text, text);
DROP FUNCTION IF EXISTS public.venue_create_booking(text, uuid, date, time, int, text, text, text, text);
DROP FUNCTION IF EXISTS public._validate_booking_contact(text, text);

CREATE OR REPLACE FUNCTION public.venue_create_booking(
  p_venue_token text, p_playing_area_id uuid, p_booking_date date, p_kickoff_time time,
  p_slot_minutes int DEFAULT NULL, p_team_id text DEFAULT NULL, p_booked_by_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_slot int; v_start timestamptz;
  v_booking_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF p_playing_area_id IS NULL OR p_booking_date IS NULL OR p_kickoff_time IS NULL THEN RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NULL AND NULLIF(trim(COALESCE(p_booked_by_name,'')),'') IS NULL THEN RAISE EXCEPTION 'booker_required' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue_id) THEN RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  v_slot := COALESCE(p_slot_minutes, 60);
  v_start := (p_booking_date + p_kickoff_time) AT TIME ZONE 'Europe/London';
  INSERT INTO pitch_bookings (id, team_id, booked_by_name, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
  VALUES (v_booking_id, p_team_id, NULLIF(trim(p_booked_by_name),''), v_venue_id, p_playing_area_id, p_booking_date, p_kickoff_time, v_slot, 'adhoc', 'confirmed');
  BEGIN
    INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 3, true);
  EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001'; END;
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
