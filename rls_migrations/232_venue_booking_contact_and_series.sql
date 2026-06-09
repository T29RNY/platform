-- Migration 232 — Venue booking: required contact capture + venue-side block series.
--
-- Drives the reworked "New booking" modal (apps/venue):
--   • Contact (email + phone) is now REQUIRED on every venue-created booking, so a
--     confirmation can be sent (Slice 2). Two new nullable columns on pitch_bookings
--     (nullable at the DB — historical/casual rows have none; the RPCs enforce required
--     for new venue bookings).
--   • venue_create_booking rewritten: adds p_contact_email + p_contact_phone (required),
--     keeps the team / walk-in booker split. OLD 7-arg signature dropped explicitly
--     (param-list change = new overload; must DROP to avoid "could not choose best
--     candidate function").
--   • venue_create_booking_series (NEW): weekly-repeat block for a REGISTERED TEAM,
--     mirroring book_pitch_series (mig 144) but venue-token auth + status='confirmed'.
--     Block for non-team bookers is deferred (would need booking_series to be
--     booker-agnostic + a renewal-cron guard — out of scope here).
--
-- All write RPCs: SECDEF, search_path pinned, resolve_venue_caller, audited, notify.
-- Granted anon + authenticated (venue admin = anon client + token).

-- ── schema: contact on a booking ──────────────────────────────────────────────
ALTER TABLE public.pitch_bookings ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.pitch_bookings ADD COLUMN IF NOT EXISTS contact_phone text;

-- ── shared validation helper (basic shape; not RFC-strict) ────────────────────
CREATE OR REPLACE FUNCTION public._validate_booking_contact(p_email text, p_phone text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NULLIF(btrim(COALESCE(p_email,'')),'') IS NULL OR p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'contact_email_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g')) < 7 THEN
    RAISE EXCEPTION 'contact_phone_required' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._validate_booking_contact(text, text) FROM PUBLIC;

-- ── venue_create_booking (rewrite: + required contact) ────────────────────────
DROP FUNCTION IF EXISTS public.venue_create_booking(text, uuid, date, time, int, text, text);
CREATE OR REPLACE FUNCTION public.venue_create_booking(
  p_venue_token     text,
  p_playing_area_id uuid,
  p_booking_date    date,
  p_kickoff_time    time,
  p_slot_minutes    int  DEFAULT NULL,
  p_team_id         text DEFAULT NULL,
  p_booked_by_name  text DEFAULT NULL,
  p_contact_email   text DEFAULT NULL,
  p_contact_phone   text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_slot int;
  v_start timestamptz;
  v_booking_id uuid := gen_random_uuid();
  v_email text := NULLIF(btrim(p_contact_email),'');
  v_phone text := NULLIF(btrim(p_contact_phone),'');
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
  PERFORM public._validate_booking_contact(v_email, v_phone);

  IF NOT EXISTS (SELECT 1 FROM playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  v_slot := COALESCE(p_slot_minutes, 60);
  v_start := (p_booking_date + p_kickoff_time) AT TIME ZONE 'Europe/London';

  INSERT INTO pitch_bookings (id, team_id, booked_by_name, contact_email, contact_phone,
    venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
  VALUES (v_booking_id, p_team_id, NULLIF(trim(p_booked_by_name),''), v_email, v_phone,
    v_venue_id, p_playing_area_id, p_booking_date, p_kickoff_time, v_slot, 'adhoc', 'confirmed');

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
                       'booked_by_name', NULLIF(trim(p_booked_by_name),''), 'contact_email', v_email, 'contact_phone', v_phone));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF p_team_id IS NOT NULL THEN PERFORM public.notify_team_change(p_team_id, 'booking_confirmed'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', 'confirmed', 'kind', 'adhoc');
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_create_booking(text, uuid, date, time, int, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_booking(text, uuid, date, time, int, text, text, text, text) TO anon, authenticated;

-- ── venue_create_booking_series (NEW: team-only weekly block, confirmed) ──────
CREATE OR REPLACE FUNCTION public.venue_create_booking_series(
  p_venue_token     text,
  p_playing_area_id uuid,
  p_kickoff_time    time,
  p_start_date      date,
  p_weeks           int,
  p_team_id         text,
  p_slot_minutes    int  DEFAULT NULL,
  p_contact_email   text DEFAULT NULL,
  p_contact_phone   text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_slot int;
  v_dow smallint;
  v_series_id uuid := gen_random_uuid();
  v_i int;
  v_date date;
  v_start timestamptz;
  v_booking_id uuid;
  v_email text := NULLIF(btrim(p_contact_email),'');
  v_phone text := NULLIF(btrim(p_contact_phone),'');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_playing_area_id IS NULL OR p_kickoff_time IS NULL OR p_start_date IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'series_team_required' USING ERRCODE = 'P0001';  -- block is team-only in v1
  END IF;
  IF p_weeks IS NULL OR p_weeks < 1 OR p_weeks > 52 THEN
    RAISE EXCEPTION 'weeks_out_of_range' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._validate_booking_contact(v_email, v_phone);

  IF NOT EXISTS (SELECT 1 FROM playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
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
      INSERT INTO pitch_bookings (id, team_id, contact_email, contact_phone, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status, series_id)
      VALUES (v_booking_id, p_team_id, v_email, v_phone, v_venue_id, p_playing_area_id, v_date, p_kickoff_time, v_slot, 'block', 'confirmed', v_series_id);
      INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
      VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 2, true);
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001', DETAIL = v_date::text;
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (p_team_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'booking_series', v_series_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'playing_area_id', p_playing_area_id, 'day_of_week', v_dow,
                       'kickoff_time', p_kickoff_time, 'slot_minutes', v_slot, 'weeks', p_weeks, 'start_date', p_start_date,
                       'kind', 'block', 'contact_email', v_email, 'contact_phone', v_phone));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  PERFORM public.notify_team_change(p_team_id, 'booking_confirmed');

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'weeks', p_weeks, 'status', 'confirmed', 'kind', 'block');
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_create_booking_series(text, uuid, time, date, int, text, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_booking_series(text, uuid, time, date, int, text, int, text, text) TO anon, authenticated;
