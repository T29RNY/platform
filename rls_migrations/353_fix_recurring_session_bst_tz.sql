-- mig 353 — Fix BST timezone bug in recurring-session generators.
--
-- Bug: the three recurring-session generators built their session timestamp with a
-- bare `(v_cursor + p_start_time)::timestamptz` cast. (date + time) yields a
-- `timestamp without time zone` (a wall-clock value); the bare ::timestamptz cast then
-- interprets that wall-clock in the DB session timezone, which is UTC. So an operator
-- who entered 18:00 got every session stored as 18:00 UTC. During British Summer Time
-- (late Mar–late Oct) the venue/member UI renders in UK local time, displaying 19:00 —
-- one hour late — and throwing booking cutoffs, QR check-in windows and conflict
-- detection off by an hour. One-off creators (venue_schedule_class_session,
-- club_create_session, club_manager_create_session) take a client-supplied timestamptz
-- and are unaffected — untouched here.
--
-- Fix: `(v_cursor + p_start_time) AT TIME ZONE 'Europe/London'` interprets the UK
-- wall-clock and returns the correct UTC instant. Established repo pattern (mig 181:430,
-- mig 143:305); same bug class previously fixed for game times in mig 207.
--
-- Bodies below are byte-identical to the live functions pulled via pg_get_functiondef
-- except the single cast line in each generation loop. CREATE OR REPLACE preserves the
-- existing GRANTs.

CREATE OR REPLACE FUNCTION public.venue_create_class_series(p_venue_token text, p_class_type_id uuid, p_instructor_id uuid, p_day_of_week smallint, p_start_time time without time zone, p_series_start date, p_price_pence integer, p_payment_mode text, p_series_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_ct        public.venue_class_types;
  v_series_id uuid;
  v_eff_end   date;
  v_cursor    date;
  v_starts    timestamptz;
  v_ends      timestamptz;
  v_created   int := 0;
  v_skipped   int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ct FROM public.venue_class_types WHERE id = p_class_type_id;
  IF NOT FOUND OR v_ct.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'class_type_not_found' USING ERRCODE='P0001'; END IF;
  IF p_payment_mode NOT IN ('prepay','door','both') THEN RAISE EXCEPTION 'bad_payment_mode' USING ERRCODE='P0001'; END IF;
  IF p_day_of_week NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE='P0001'; END IF;
  IF p_series_start IS NULL OR p_start_time IS NULL THEN RAISE EXCEPTION 'schedule_required' USING ERRCODE='P0001'; END IF;
  IF p_series_end IS NOT NULL AND p_series_end < p_series_start THEN RAISE EXCEPTION 'end_before_start' USING ERRCODE='P0001'; END IF;
  IF COALESCE(p_price_pence, 0) < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_admins WHERE id = p_instructor_id AND venue_id = v_caller.venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'instructor_not_found' USING ERRCODE='P0001';
  END IF;
  v_eff_end := COALESCE(p_series_end, p_series_start + INTERVAL '180 days');
  INSERT INTO public.venue_class_series
    (class_type_id, instructor_id, day_of_week, start_time, series_start, series_end, price_pence, payment_mode)
  VALUES
    (p_class_type_id, p_instructor_id, p_day_of_week, p_start_time, p_series_start, p_series_end,
     COALESCE(p_price_pence, 0), p_payment_mode)
  RETURNING id INTO v_series_id;
  v_cursor := p_series_start + ((p_day_of_week - EXTRACT(DOW FROM p_series_start)::int + 7) % 7) * INTERVAL '1 day';
  WHILE v_cursor <= v_eff_end LOOP
    v_starts := (v_cursor + p_start_time) AT TIME ZONE 'Europe/London';
    v_ends   := v_starts + (v_ct.duration_minutes * INTERVAL '1 minute');
    IF public._space_is_available(v_ct.space_id, v_starts, v_ends) THEN
      INSERT INTO public.venue_class_sessions
        (venue_id, class_type_id, series_id, instructor_id, space_id, starts_at, ends_at,
         capacity, status, price_pence, payment_mode)
      VALUES
        (v_caller.venue_id, p_class_type_id, v_series_id, p_instructor_id, v_ct.space_id, v_starts, v_ends,
         v_ct.default_capacity, 'scheduled', COALESCE(p_price_pence, 0), p_payment_mode);
      v_created := v_created + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
    v_cursor := v_cursor + INTERVAL '7 days';
  END LOOP;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_series_created', 'venue_class_series', v_series_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'class_type_id', p_class_type_id,
                             'sessions_created', v_created, 'sessions_skipped', v_skipped));
  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id,
                            'sessions_created', v_created, 'sessions_skipped', v_skipped);
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_create_session_series(p_venue_token text, p_club_id text, p_title text, p_session_type text, p_day_of_week integer, p_start_time time without time zone, p_from_date date, p_to_date date, p_cohort_id uuid DEFAULT NULL::uuid, p_team_id uuid DEFAULT NULL::uuid, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_series_id uuid;
  v_title     text := NULLIF(btrim(p_title), '');
  v_cursor    date;
  v_count     int  := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL THEN RAISE EXCEPTION 'dates_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date > p_to_date THEN RAISE EXCEPTION 'from_after_to' USING ERRCODE = 'P0001'; END IF;
  IF p_day_of_week NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_cohorts WHERE id = p_cohort_id AND club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_teams WHERE id = p_team_id AND club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_session_series
    (club_id, cohort_id, team_id, title, session_type,
     day_of_week, start_time, from_date, to_date, location, notes, capacity)
  VALUES
    (p_club_id, p_cohort_id, p_team_id, v_title, p_session_type,
     p_day_of_week, p_start_time, p_from_date, p_to_date, p_location, p_notes, p_capacity)
  RETURNING id INTO v_series_id;

  -- Advance to first date on or after from_date that matches target day_of_week
  v_cursor := p_from_date + ((p_day_of_week - EXTRACT(DOW FROM p_from_date)::int + 7) % 7) * INTERVAL '1 day';

  WHILE v_cursor <= p_to_date LOOP
    INSERT INTO public.club_sessions
      (club_id, cohort_id, team_id, title, session_type,
       series_id, scheduled_at, location, notes, capacity)
    VALUES
      (p_club_id, p_cohort_id, p_team_id, v_title, p_session_type,
       v_series_id, (v_cursor + p_start_time) AT TIME ZONE 'Europe/London', p_location, p_notes, p_capacity);
    v_count  := v_count + 1;
    v_cursor := v_cursor + INTERVAL '7 days';
  END LOOP;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_series_created', 'club_session_series', v_series_id::text,
          jsonb_build_object('club_id', p_club_id, 'title', v_title,
                             'day_of_week', p_day_of_week, 'sessions_created', v_count));

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'sessions_created', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_manager_create_session_series(p_team_id uuid, p_title text, p_day_of_week integer, p_start_time time without time zone, p_from_date date, p_to_date date, p_session_type text DEFAULT 'training'::text, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile    record;
  v_team       record;
  v_series_id  uuid;
  v_title      text := NULLIF(btrim(p_title), '');
  v_cursor     date;
  v_count      int  := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL THEN RAISE EXCEPTION 'dates_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date > p_to_date THEN RAISE EXCEPTION 'from_after_to' USING ERRCODE = 'P0001'; END IF;
  IF p_day_of_week NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_team FROM public.club_teams WHERE id = p_team_id;

  INSERT INTO public.club_session_series
    (club_id, cohort_id, team_id, title, session_type,
     day_of_week, start_time, from_date, to_date, location, notes, capacity)
  VALUES
    (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type,
     p_day_of_week, p_start_time, p_from_date, p_to_date, p_location, p_notes, p_capacity)
  RETURNING id INTO v_series_id;

  -- Advance to first date on or after from_date that matches target day_of_week
  v_cursor := p_from_date + ((p_day_of_week - EXTRACT(DOW FROM p_from_date)::int + 7) % 7) * INTERVAL '1 day';

  WHILE v_cursor <= p_to_date LOOP
    INSERT INTO public.club_sessions
      (club_id, cohort_id, team_id, title, session_type,
       series_id, scheduled_at, location, notes, capacity, status)
    VALUES
      (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type,
       v_series_id, (v_cursor + p_start_time) AT TIME ZONE 'Europe/London', p_location, p_notes, p_capacity, 'scheduled');
    v_count  := v_count + 1;
    v_cursor := v_cursor + INTERVAL '7 days';
  END LOOP;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'manager_series_created', 'club_session_series', v_series_id::text,
    jsonb_build_object('team_id', p_team_id, 'club_id', v_team.club_id,
                       'title', v_title, 'day_of_week', p_day_of_week,
                       'sessions_created', v_count)
  );

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'sessions_created', v_count);
END;
$function$;
