-- 535_holiday_camps_create_rpcs.sql — P9.2 Holiday Camps: create RPCs.
--
-- Two writes on the class engine (mig 534 added the schema):
--   1. venue_create_class_type — EXTENDED with the camp flavour + audience/cohort targeting.
--      Adding params changes the signature, so the old 11-arg overload is DROPPED first
--      (overload rule) and grants re-established after CREATE.
--   2. venue_create_camp — NEW. Emits the camp's bookable sessions from the class type:
--      per_day  -> one venue_class_sessions row per day date_from..date_to (space-clash days skipped);
--      block    -> ONE row with end_date=date_to (space clash -> hard error, the whole camp fails).
--      booking_mode is DERIVED from the class type (single source of truth) — not a param.
--
-- Both are venue-operator writes (resolve_venue_caller: venue_admin_token OR authed venue_admin),
-- SECURITY DEFINER, coaching-feature-gated, audit-logged. Reuse the venue_create_class_series
-- session-emit idiom (London wall-clock -> timestamptz, _space_is_available clash check).

-- ── 1. venue_create_class_type (extended) ───────────────────────────────────
DROP FUNCTION IF EXISTS public.venue_create_class_type(text, text, uuid, integer, integer, text, integer, boolean, text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.venue_create_class_type(
  p_venue_token text,
  p_name text,
  p_space_id uuid,
  p_duration_minutes integer,
  p_default_capacity integer,
  p_category text,
  p_cancellation_cutoff_hours integer DEFAULT 2,
  p_first_session_free boolean DEFAULT false,
  p_description text DEFAULT NULL::text,
  p_is_sparring boolean DEFAULT false,
  p_members_only boolean DEFAULT true,
  -- Holiday Camps (mig 534/535, P9.2):
  p_is_camp boolean DEFAULT false,
  p_camp_info text DEFAULT NULL::text,
  p_camp_dietary text DEFAULT NULL::text,
  p_pickup_time time without time zone DEFAULT NULL::time,
  p_dropoff_time time without time zone DEFAULT NULL::time,
  p_pickup_location text DEFAULT NULL::text,
  p_dropoff_location text DEFAULT NULL::text,
  p_booking_mode text DEFAULT 'per_day',
  p_audience text DEFAULT 'all',
  p_target_team_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_id     uuid;
  v_target uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  IF p_category NOT IN ('fitness','yoga','dance','martial_arts','other') THEN RAISE EXCEPTION 'bad_category' USING ERRCODE='P0001'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN RAISE EXCEPTION 'bad_duration' USING ERRCODE='P0001'; END IF;
  IF p_default_capacity IS NULL OR p_default_capacity < 0 THEN RAISE EXCEPTION 'bad_capacity' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_spaces WHERE id = p_space_id AND venue_id = v_caller.venue_id) THEN
    RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001';
  END IF;

  -- camp targeting validation
  IF p_booking_mode NOT IN ('per_day','block') THEN RAISE EXCEPTION 'bad_booking_mode' USING ERRCODE='P0001'; END IF;
  IF p_audience NOT IN ('all','team') THEN RAISE EXCEPTION 'bad_audience' USING ERRCODE='P0001'; END IF;
  v_target := p_target_team_id;
  IF p_audience = 'all' THEN
    v_target := NULL;                          -- an 'all' camp names no team (also enforced by the CHECK)
  ELSE
    -- 'team': target required at WRITE time (the schema CHECK only guards all=>NULL, so the FK's
    -- ON DELETE SET NULL can later blank it without aborting a team/club delete).
    IF v_target IS NULL THEN RAISE EXCEPTION 'target_team_required' USING ERRCODE='P0001'; END IF;
    -- and it must be a team of a club linked to THIS venue (no cross-club targeting)
    IF NOT EXISTS (
      SELECT 1 FROM public.club_teams ct
      JOIN public.club_venues cv ON cv.club_id = ct.club_id
      WHERE ct.id = v_target AND cv.venue_id = v_caller.venue_id
    ) THEN
      RAISE EXCEPTION 'target_team_not_found' USING ERRCODE='P0001';
    END IF;
  END IF;

  INSERT INTO public.venue_class_types
    (venue_id, space_id, name, description, category, duration_minutes,
     default_capacity, cancellation_cutoff_hours, first_session_free, is_sparring, members_only,
     is_camp, camp_info, camp_dietary, pickup_time, dropoff_time, pickup_location, dropoff_location,
     booking_mode, audience, target_team_id)
  VALUES
    (v_caller.venue_id, p_space_id, btrim(p_name), p_description, p_category, p_duration_minutes,
     p_default_capacity, COALESCE(p_cancellation_cutoff_hours, 2), COALESCE(p_first_session_free, false),
     COALESCE(p_is_sparring, false), COALESCE(p_members_only, true),
     COALESCE(p_is_camp, false), p_camp_info, p_camp_dietary, p_pickup_time, p_dropoff_time,
     p_pickup_location, p_dropoff_location, p_booking_mode, p_audience, v_target)
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_type_created', 'venue_class_type', v_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'name', btrim(p_name), 'category', p_category,
                             'is_sparring', COALESCE(p_is_sparring, false),
                             'members_only', COALESCE(p_members_only, true),
                             'is_camp', COALESCE(p_is_camp, false),
                             'audience', p_audience, 'booking_mode', p_booking_mode));
  RETURN jsonb_build_object('ok', true, 'class_type_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_create_class_type(text, text, uuid, integer, integer, text, integer, boolean, text, boolean, boolean, boolean, text, text, time without time zone, time without time zone, text, text, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_create_class_type(text, text, uuid, integer, integer, text, integer, boolean, text, boolean, boolean, boolean, text, text, time without time zone, time without time zone, text, text, text, text, uuid) TO anon, authenticated, service_role;

-- ── 2. venue_create_camp (new) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_camp(
  p_venue_token text,
  p_class_type_id uuid,
  p_instructor_id uuid,
  p_date_from date,
  p_date_to date,
  p_daily_start_time time without time zone,
  p_price_pence integer,
  p_payment_mode text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  record;
  v_ct      public.venue_class_types;
  v_mode    text;
  v_cursor  date;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_created int := 0;
  v_skipped int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ct FROM public.venue_class_types WHERE id = p_class_type_id;
  IF NOT FOUND OR v_ct.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'class_type_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT v_ct.is_camp THEN RAISE EXCEPTION 'not_a_camp' USING ERRCODE='P0001'; END IF;

  IF p_payment_mode NOT IN ('prepay','door','both') THEN RAISE EXCEPTION 'bad_payment_mode' USING ERRCODE='P0001'; END IF;
  IF COALESCE(p_price_pence, 0) < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_daily_start_time IS NULL THEN RAISE EXCEPTION 'schedule_required' USING ERRCODE='P0001'; END IF;
  IF p_date_to < p_date_from THEN RAISE EXCEPTION 'end_before_start' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_admins WHERE id = p_instructor_id AND venue_id = v_caller.venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'instructor_not_found' USING ERRCODE='P0001';
  END IF;

  v_mode := v_ct.booking_mode;

  IF v_mode = 'block' THEN
    -- One session covering the day-1 time window; end_date spans to date_to.
    v_starts := (p_date_from + p_daily_start_time) AT TIME ZONE 'Europe/London';
    v_ends   := v_starts + (v_ct.duration_minutes * INTERVAL '1 minute');
    IF NOT public._space_is_available(v_ct.space_id, v_starts, v_ends) THEN
      RAISE EXCEPTION 'space_unavailable' USING ERRCODE='P0001';
    END IF;
    INSERT INTO public.venue_class_sessions
      (venue_id, class_type_id, instructor_id, space_id, starts_at, ends_at,
       capacity, status, price_pence, payment_mode, end_date)
    VALUES
      (v_caller.venue_id, p_class_type_id, p_instructor_id, v_ct.space_id, v_starts, v_ends,
       v_ct.default_capacity, 'scheduled', COALESCE(p_price_pence, 0), p_payment_mode, p_date_to);
    v_created := 1;
  ELSE
    -- per_day: one bookable session per day; clashing days are skipped (reported), not fatal.
    v_cursor := p_date_from;
    WHILE v_cursor <= p_date_to LOOP
      v_starts := (v_cursor + p_daily_start_time) AT TIME ZONE 'Europe/London';
      v_ends   := v_starts + (v_ct.duration_minutes * INTERVAL '1 minute');
      IF public._space_is_available(v_ct.space_id, v_starts, v_ends) THEN
        INSERT INTO public.venue_class_sessions
          (venue_id, class_type_id, instructor_id, space_id, starts_at, ends_at,
           capacity, status, price_pence, payment_mode, end_date)
        VALUES
          (v_caller.venue_id, p_class_type_id, p_instructor_id, v_ct.space_id, v_starts, v_ends,
           v_ct.default_capacity, 'scheduled', COALESCE(p_price_pence, 0), p_payment_mode, NULL);
        v_created := v_created + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
      v_cursor := v_cursor + 1;
    END LOOP;
    IF v_created = 0 THEN RAISE EXCEPTION 'space_unavailable' USING ERRCODE='P0001'; END IF;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_camp_created', 'venue_class_type', p_class_type_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'class_type_id', p_class_type_id,
                             'booking_mode', v_mode, 'date_from', p_date_from, 'date_to', p_date_to,
                             'sessions_created', v_created, 'sessions_skipped', v_skipped));

  RETURN jsonb_build_object('ok', true, 'class_type_id', p_class_type_id, 'booking_mode', v_mode,
                            'sessions_created', v_created, 'sessions_skipped', v_skipped);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_create_camp(text, uuid, uuid, date, date, time without time zone, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_create_camp(text, uuid, uuid, date, date, time without time zone, integer, text) TO anon, authenticated, service_role;
