-- Migration 228: get_pitch_free_slots_series
--
-- The casual app's weekly-block booking (apps/inorout BookPitchModal) loaded free
-- slots for the FIRST week only (get_pitch_free_slots on the start date). A slot
-- free on week 1 but taken on a later week looked bookable, then book_pitch_series
-- failed the whole block atomically with slot_unavailable. This sibling RPC
-- returns only slots that are free across ALL N weekly occurrences, so the block
-- picker never offers a slot that would fail.
--
-- slot_start is week 1 (the start date) so the caller passes the same kickoff time
-- + start date to book_pitch_series unchanged. Slot generation mirrors
-- get_pitch_free_slots exactly; the only difference is the availability test loops
-- over weeks 0..N-1 using the same +7-day / Europe/London arithmetic as
-- book_pitch_series and requires every week clear.
--
-- A separate RPC (not an overload of get_pitch_free_slots) keeps the hot one-off
-- slot path untouched. Read-only; anon+authenticated to mirror get_pitch_free_slots.

CREATE OR REPLACE FUNCTION public.get_pitch_free_slots_series(
  p_venue_id text, p_start_date date, p_weeks integer, p_slot_length integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dow      int := EXTRACT(DOW FROM p_start_date)::int;  -- 0=Sun..6=Sat
  v_weeks    int := GREATEST(COALESCE(p_weeks, 1), 1);
  v_pa       record;
  v_windows  jsonb;
  v_w        jsonb;
  v_len      int;
  v_open_ts  timestamp;
  v_close_ts timestamp;
  v_cur      timestamp;
  v_slot_time time;
  v_k        int;
  v_naive    timestamp;
  v_start_tz timestamptz;
  v_end_tz   timestamptz;
  v_free_all boolean;
  v_out      jsonb := '[]'::jsonb;
BEGIN
  IF p_venue_id IS NULL OR p_start_date IS NULL THEN
    RAISE EXCEPTION 'venue_and_date_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_weeks > 52 THEN
    RAISE EXCEPTION 'weeks_out_of_range' USING ERRCODE = 'P0001';
  END IF;

  FOR v_pa IN
    SELECT pa.id, pa.name, pa.booking_windows
    FROM playing_areas pa
    WHERE pa.venue_id = p_venue_id
      AND pa.active = true
      AND pa.is_available = true
    ORDER BY pa.sort_order, pa.name
  LOOP
    IF v_pa.booking_windows IS NULL OR jsonb_array_length(v_pa.booking_windows) = 0 THEN
      v_windows := jsonb_build_array(jsonb_build_object(
        'day_of_week', v_dow, 'open_time', '08:00', 'close_time', '22:00',
        'slot_lengths', jsonb_build_array(60)));
    ELSE
      SELECT COALESCE(jsonb_agg(w), '[]'::jsonb) INTO v_windows
      FROM jsonb_array_elements(v_pa.booking_windows) w
      WHERE (w->>'day_of_week')::int = v_dow;
    END IF;

    FOR v_w IN SELECT * FROM jsonb_array_elements(v_windows) LOOP
      FOR v_len IN
        SELECT (e::text)::int FROM jsonb_array_elements(v_w->'slot_lengths') e
        WHERE p_slot_length IS NULL OR (e::text)::int = p_slot_length
      LOOP
        v_open_ts  := p_start_date + (v_w->>'open_time')::time;
        v_close_ts := p_start_date + (v_w->>'close_time')::time;
        v_cur := v_open_ts;
        WHILE v_cur + make_interval(mins => v_len) <= v_close_ts LOOP
          v_slot_time := v_cur::time;
          v_free_all := true;
          -- the slot must be clear on EVERY weekly occurrence
          FOR v_k IN 0 .. (v_weeks - 1) LOOP
            v_naive := (p_start_date + v_k * 7) + v_slot_time;
            v_start_tz := v_naive AT TIME ZONE 'Europe/London';
            v_end_tz   := (v_naive + make_interval(mins => v_len)) AT TIME ZONE 'Europe/London';
            IF EXISTS (
              SELECT 1 FROM pitch_occupancy po
              WHERE po.playing_area_id = v_pa.id AND po.active
                AND po.time_range && tstzrange(v_start_tz, v_end_tz, '[)')
            ) THEN
              v_free_all := false;
              EXIT;
            END IF;
          END LOOP;

          IF v_free_all THEN
            -- slot_start = week 1, so the caller books the series from p_start_date
            v_out := v_out || jsonb_build_object(
              'playing_area_id', v_pa.id,
              'pitch_name', v_pa.name,
              'slot_start', (p_start_date + v_slot_time) AT TIME ZONE 'Europe/London',
              'slot_end', (p_start_date + v_slot_time + make_interval(mins => v_len)) AT TIME ZONE 'Europe/London',
              'slot_minutes', v_len);
          END IF;
          v_cur := v_cur + make_interval(mins => v_len);
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pitch_free_slots_series(text, date, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pitch_free_slots_series(text, date, integer, integer) TO anon, authenticated;
