-- 412_multi_venue_phase1_sessions_down.sql
-- Reverse of 412: drop the venue-anchored RPC overloads + restore the pre-412 bodies,
-- restore the 3 readers to their pre-412 shapes, drop the guard, drop the columns.

-- Drop new overloads
DROP FUNCTION IF EXISTS public.club_create_session(text,text,text,timestamptz,uuid,text,text,integer,text,uuid);
DROP FUNCTION IF EXISTS public.club_update_session(text,uuid,text,timestamptz,text,text,integer,text,uuid);
DROP FUNCTION IF EXISTS public.club_create_session_series(text,text,text,text,integer,time,date,date,uuid,uuid,text,text,integer,text,uuid);
DROP FUNCTION IF EXISTS public.club_manager_create_session(uuid,text,timestamptz,text,text,text,integer,timestamptz,text,text,text,text,text,uuid);
DROP FUNCTION IF EXISTS public.club_manager_create_session_series(uuid,text,integer,time,date,date,text,text,text,integer,text,uuid);

-- Restore club_create_session (pre-412)
CREATE OR REPLACE FUNCTION public.club_create_session(
  p_venue_token text, p_club_id text, p_title text, p_scheduled_at timestamptz,
  p_cohort_id uuid DEFAULT NULL, p_location text DEFAULT NULL, p_notes text DEFAULT NULL, p_capacity integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_session_id uuid; v_title text := NULLIF(btrim(p_title), '');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  IF p_scheduled_at IS NULL THEN RAISE EXCEPTION 'scheduled_at_required' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.club_cohorts WHERE id = p_cohort_id AND club_id = p_club_id) THEN RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.club_sessions (club_id, cohort_id, title, scheduled_at, location, notes, capacity)
  VALUES (p_club_id, p_cohort_id, v_title, p_scheduled_at, p_location, p_notes, p_capacity) RETURNING id INTO v_session_id;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'club_session_created', 'club_session', v_session_id::text,
          jsonb_build_object('club_id', p_club_id, 'title', v_title, 'scheduled_at', p_scheduled_at));
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.club_create_session(text,text,text,timestamptz,uuid,text,text,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_create_session(text,text,text,timestamptz,uuid,text,text,integer) TO anon, authenticated;

-- Restore club_update_session (pre-412)
CREATE OR REPLACE FUNCTION public.club_update_session(
  p_venue_token text, p_session_id uuid, p_title text DEFAULT NULL, p_scheduled_at timestamptz DEFAULT NULL,
  p_location text DEFAULT NULL, p_notes text DEFAULT NULL, p_capacity integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_session_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.club_sessions cs SET
    title = COALESCE(NULLIF(btrim(p_title), ''), cs.title), scheduled_at = COALESCE(p_scheduled_at, cs.scheduled_at),
    location = COALESCE(p_location, cs.location), notes = COALESCE(p_notes, cs.notes),
    capacity = COALESCE(p_capacity, cs.capacity), updated_at = now()
  FROM public.club_venues cv
  WHERE cs.id = p_session_id AND cv.club_id = cs.club_id AND cv.venue_id = v_venue_id AND cs.status = 'scheduled'
  RETURNING cs.id INTO v_session_id;
  IF v_session_id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'club_session_updated', 'club_session', v_session_id::text,
          jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.club_update_session(text,uuid,text,timestamptz,text,text,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_update_session(text,uuid,text,timestamptz,text,text,integer) TO anon, authenticated;

-- Restore club_create_session_series (pre-412)
CREATE OR REPLACE FUNCTION public.club_create_session_series(
  p_venue_token text, p_club_id text, p_title text, p_session_type text, p_day_of_week integer,
  p_start_time time without time zone, p_from_date date, p_to_date date,
  p_cohort_id uuid DEFAULT NULL, p_team_id uuid DEFAULT NULL, p_location text DEFAULT NULL, p_notes text DEFAULT NULL, p_capacity integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_series_id uuid; v_title text := NULLIF(btrim(p_title), ''); v_cursor date; v_count int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL THEN RAISE EXCEPTION 'dates_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date > p_to_date THEN RAISE EXCEPTION 'from_after_to' USING ERRCODE = 'P0001'; END IF;
  IF p_day_of_week NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.club_cohorts WHERE id = p_cohort_id AND club_id = p_club_id) THEN RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.club_teams WHERE id = p_team_id AND club_id = p_club_id) THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.club_session_series (club_id, cohort_id, team_id, title, session_type, day_of_week, start_time, from_date, to_date, location, notes, capacity)
  VALUES (p_club_id, p_cohort_id, p_team_id, v_title, p_session_type, p_day_of_week, p_start_time, p_from_date, p_to_date, p_location, p_notes, p_capacity)
  RETURNING id INTO v_series_id;
  v_cursor := p_from_date + ((p_day_of_week - EXTRACT(DOW FROM p_from_date)::int + 7) % 7) * INTERVAL '1 day';
  WHILE v_cursor <= p_to_date LOOP
    INSERT INTO public.club_sessions (club_id, cohort_id, team_id, title, session_type, series_id, scheduled_at, location, notes, capacity)
    VALUES (p_club_id, p_cohort_id, p_team_id, v_title, p_session_type, v_series_id, (v_cursor + p_start_time) AT TIME ZONE 'Europe/London', p_location, p_notes, p_capacity);
    v_count := v_count + 1; v_cursor := v_cursor + INTERVAL '7 days';
  END LOOP;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'club_series_created', 'club_session_series', v_series_id::text,
          jsonb_build_object('club_id', p_club_id, 'title', v_title, 'day_of_week', p_day_of_week, 'sessions_created', v_count));
  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'sessions_created', v_count);
END; $fn$;
REVOKE ALL ON FUNCTION public.club_create_session_series(text,text,text,text,integer,time,date,date,uuid,uuid,text,text,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_create_session_series(text,text,text,text,integer,time,date,date,uuid,uuid,text,text,integer) TO anon, authenticated;

-- Restore club_manager_create_session (pre-412)
CREATE OR REPLACE FUNCTION public.club_manager_create_session(
  p_team_id uuid, p_title text, p_scheduled_at timestamptz, p_session_type text DEFAULT 'training',
  p_location text DEFAULT NULL, p_notes text DEFAULT NULL, p_capacity integer DEFAULT NULL, p_meet_time timestamptz DEFAULT NULL,
  p_opponent_name text DEFAULT NULL, p_home_away text DEFAULT NULL, p_opponent_venue_name text DEFAULT NULL, p_opponent_address text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile record; v_team record; v_session_id uuid; v_title text := NULLIF(btrim(p_title), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_team_managers WHERE team_id = p_team_id AND member_profile_id = v_profile.id AND is_active = true) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_team FROM public.club_teams WHERE id = p_team_id;
  INSERT INTO public.club_sessions (club_id, cohort_id, team_id, title, session_type, scheduled_at, location, notes, capacity, meet_time, opponent_name, home_away, opponent_venue_name, opponent_address, status)
  VALUES (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type, p_scheduled_at, p_location, p_notes, p_capacity, p_meet_time, p_opponent_name, p_home_away, p_opponent_venue_name, p_opponent_address, 'scheduled')
  RETURNING id INTO v_session_id;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'player', v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''), 'manager_session_created', 'club_sessions', v_session_id::text,
          jsonb_build_object('team_id', p_team_id, 'club_id', v_team.club_id, 'title', v_title, 'scheduled_at', p_scheduled_at));
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.club_manager_create_session(uuid,text,timestamptz,text,text,text,integer,timestamptz,text,text,text,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_create_session(uuid,text,timestamptz,text,text,text,integer,timestamptz,text,text,text,text) TO authenticated;

-- Restore club_manager_create_session_series (pre-412)
CREATE OR REPLACE FUNCTION public.club_manager_create_session_series(
  p_team_id uuid, p_title text, p_day_of_week integer, p_start_time time without time zone, p_from_date date, p_to_date date,
  p_session_type text DEFAULT 'training', p_location text DEFAULT NULL, p_notes text DEFAULT NULL, p_capacity integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_profile record; v_team record; v_series_id uuid; v_title text := NULLIF(btrim(p_title), ''); v_cursor date; v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_team_managers WHERE team_id = p_team_id AND member_profile_id = v_profile.id AND is_active = true) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL THEN RAISE EXCEPTION 'dates_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date > p_to_date THEN RAISE EXCEPTION 'from_after_to' USING ERRCODE = 'P0001'; END IF;
  IF p_day_of_week NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_team FROM public.club_teams WHERE id = p_team_id;
  INSERT INTO public.club_session_series (club_id, cohort_id, team_id, title, session_type, day_of_week, start_time, from_date, to_date, location, notes, capacity)
  VALUES (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type, p_day_of_week, p_start_time, p_from_date, p_to_date, p_location, p_notes, p_capacity)
  RETURNING id INTO v_series_id;
  v_cursor := p_from_date + ((p_day_of_week - EXTRACT(DOW FROM p_from_date)::int + 7) % 7) * INTERVAL '1 day';
  WHILE v_cursor <= p_to_date LOOP
    INSERT INTO public.club_sessions (club_id, cohort_id, team_id, title, session_type, series_id, scheduled_at, location, notes, capacity, status)
    VALUES (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type, v_series_id, (v_cursor + p_start_time) AT TIME ZONE 'Europe/London', p_location, p_notes, p_capacity, 'scheduled');
    v_count := v_count + 1; v_cursor := v_cursor + INTERVAL '7 days';
  END LOOP;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'player', v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''), 'manager_series_created', 'club_session_series', v_series_id::text,
          jsonb_build_object('team_id', p_team_id, 'club_id', v_team.club_id, 'title', v_title, 'day_of_week', p_day_of_week, 'sessions_created', v_count));
  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'sessions_created', v_count);
END; $fn$;
REVOKE ALL ON FUNCTION public.club_manager_create_session_series(uuid,text,integer,time,date,date,text,text,text,integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_create_session_series(uuid,text,integer,time,date,date,text,text,text,integer) TO authenticated;

-- Restore readers to pre-412 shapes (member_list_upcoming_sessions, club_list_sessions, venue_list_club_venues)
-- — re-run migrations 401/298/(venue_list_club_venues origin) bodies if a full revert is needed.
-- For practical rollback the new keys are additive and harmless; the columns + guard are the real revert:

DROP FUNCTION IF EXISTS public._venue_in_club_operator(text, text, text);

ALTER TABLE public.club_sessions       DROP COLUMN IF EXISTS playing_area_id, DROP COLUMN IF EXISTS venue_id;
ALTER TABLE public.club_session_series DROP COLUMN IF EXISTS playing_area_id, DROP COLUMN IF EXISTS venue_id;

SELECT pg_notify('pgrst', 'reload schema');
