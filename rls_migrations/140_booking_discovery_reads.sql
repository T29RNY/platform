-- Migration 140 — Pitch Booking Stage 3 (booking-owned): casual reads.
-- Both PII-free, GRANT anon+authenticated (discovery works pre-auth;
-- the booking WRITE is auth-gated in Stage 4).

-- ──────────────────────────────────────────────────────────────────
-- search_bookable_venues(p_query) — typeahead over opted-in venues
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_bookable_venues(p_query text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'venue_id', s.id, 'name', s.name, 'slug', s.slug, 'city', s.city)
         ORDER BY s.name), '[]'::jsonb)
  FROM (
    SELECT v.id, v.name, v.slug, v.city
    FROM venues v
    WHERE v.bookings_enabled = true AND v.active = true
      AND (
        p_query IS NULL OR length(trim(p_query)) = 0
        OR v.name ILIKE '%' || trim(p_query) || '%'
        OR v.slug ILIKE '%' || trim(p_query) || '%'
        OR v.city ILIKE '%' || trim(p_query) || '%'
      )
    ORDER BY v.name
    LIMIT 20
  ) s;
$function$;
REVOKE ALL ON FUNCTION public.search_bookable_venues(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_bookable_venues(text) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- get_pitch_free_slots(p_venue_id, p_date, p_playing_area_id?, p_slot_length?)
-- Expand booking_windows for p_date's weekday → candidate slots per offered
-- length (back-to-back from open_time) → subtract active occupancy.
-- Graceful default 08:00–22:00 / 60-min when a pitch has no booking_windows.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pitch_free_slots(
  p_venue_id        text,
  p_date            date,
  p_playing_area_id uuid DEFAULT NULL,
  p_slot_length     int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_dow      int := EXTRACT(DOW FROM p_date)::int;  -- 0=Sun..6=Sat
  v_pa       record;
  v_windows  jsonb;
  v_w        jsonb;
  v_len      int;
  v_open_ts  timestamp;
  v_close_ts timestamp;
  v_cur      timestamp;
  v_start_tz timestamptz;
  v_end_tz   timestamptz;
  v_out      jsonb := '[]'::jsonb;
BEGIN
  IF p_venue_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'venue_and_date_required' USING ERRCODE = 'P0001';
  END IF;

  FOR v_pa IN
    SELECT pa.id, pa.name, pa.booking_windows
    FROM playing_areas pa
    WHERE pa.venue_id = p_venue_id
      AND pa.active = true
      AND pa.is_available = true
      AND (p_playing_area_id IS NULL OR pa.id = p_playing_area_id)
    ORDER BY pa.sort_order, pa.name
  LOOP
    -- windows for this weekday; graceful default if the pitch has none configured
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
        v_open_ts  := p_date + (v_w->>'open_time')::time;
        v_close_ts := p_date + (v_w->>'close_time')::time;
        v_cur := v_open_ts;
        WHILE v_cur + make_interval(mins => v_len) <= v_close_ts LOOP
          v_start_tz := v_cur AT TIME ZONE 'Europe/London';
          v_end_tz   := (v_cur + make_interval(mins => v_len)) AT TIME ZONE 'Europe/London';
          IF NOT EXISTS (
            SELECT 1 FROM pitch_occupancy po
            WHERE po.playing_area_id = v_pa.id AND po.active
              AND po.time_range && tstzrange(v_start_tz, v_end_tz, '[)')
          ) THEN
            v_out := v_out || jsonb_build_object(
              'playing_area_id', v_pa.id,
              'pitch_name', v_pa.name,
              'slot_start', v_start_tz,
              'slot_end', v_end_tz,
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
REVOKE ALL ON FUNCTION public.get_pitch_free_slots(text, date, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pitch_free_slots(text, date, uuid, int) TO anon, authenticated;
