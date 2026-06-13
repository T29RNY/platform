-- Migration 303 — Phase 10 Club Attendance: Slice 4D
-- Six manager-facing RPCs. Auth: auth.uid() → member_profiles → club_team_managers.
-- No venue token. All authenticated only (anon explicitly revoked).
-- Write RPCs (1–3, 5–6) audit to audit_events (team_id='_system', actor_type='player').
-- Read RPC (4) is auth-gated but no audit write.

-- ─── 1. club_manager_create_session ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_manager_create_session(
  p_team_id             uuid,
  p_title               text,
  p_scheduled_at        timestamptz,
  p_session_type        text        DEFAULT 'training',
  p_location            text        DEFAULT NULL,
  p_notes               text        DEFAULT NULL,
  p_capacity            integer     DEFAULT NULL,
  p_meet_time           timestamptz DEFAULT NULL,
  p_opponent_name       text        DEFAULT NULL,
  p_home_away           text        DEFAULT NULL,
  p_opponent_venue_name text        DEFAULT NULL,
  p_opponent_address    text        DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile    record;
  v_team       record;
  v_session_id uuid;
  v_title      text := NULLIF(btrim(p_title), '');
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

  SELECT * INTO v_team FROM public.club_teams WHERE id = p_team_id;

  INSERT INTO public.club_sessions
    (club_id, cohort_id, team_id, title, session_type, scheduled_at,
     location, notes, capacity, meet_time, opponent_name, home_away,
     opponent_venue_name, opponent_address, status)
  VALUES
    (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type, p_scheduled_at,
     p_location, p_notes, p_capacity, p_meet_time, p_opponent_name, p_home_away,
     p_opponent_venue_name, p_opponent_address, 'scheduled')
  RETURNING id INTO v_session_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'manager_session_created', 'club_sessions', v_session_id::text,
    jsonb_build_object('team_id', p_team_id, 'club_id', v_team.club_id,
                       'title', v_title, 'scheduled_at', p_scheduled_at)
  );

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_create_session(uuid,text,timestamptz,text,text,text,integer,timestamptz,text,text,text,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_create_session(uuid,text,timestamptz,text,text,text,integer,timestamptz,text,text,text,text) TO authenticated;

-- ─── 2. club_manager_create_session_series ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_manager_create_session_series(
  p_team_id      uuid,
  p_title        text,
  p_day_of_week  int,
  p_start_time   time,
  p_from_date    date,
  p_to_date      date,
  p_session_type text    DEFAULT 'training',
  p_location     text    DEFAULT NULL,
  p_notes        text    DEFAULT NULL,
  p_capacity     integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
       v_series_id, (v_cursor + p_start_time)::timestamptz, p_location, p_notes, p_capacity, 'scheduled');
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
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_create_session_series(uuid,text,int,time,date,date,text,text,text,integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_create_session_series(uuid,text,int,time,date,date,text,text,text,integer) TO authenticated;

-- ─── 3. club_manager_cancel_session ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_manager_cancel_session(
  p_session_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile    record;
  v_session    record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_session FROM public.club_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_session.team_id IS NULL THEN RAISE EXCEPTION 'not_team_session' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = v_session.team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  IF v_session.status <> 'scheduled' THEN RAISE EXCEPTION 'session_not_scheduled' USING ERRCODE = 'P0001'; END IF;
  IF v_session.scheduled_at <= now() THEN RAISE EXCEPTION 'session_in_past' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.club_sessions SET
    status           = 'cancelled',
    cancelled_reason = p_reason,
    updated_at       = now()
  WHERE id = p_session_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'manager_session_cancelled', 'club_sessions', p_session_id::text,
    jsonb_build_object('team_id', v_session.team_id, 'club_id', v_session.club_id,
                       'reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_cancel_session(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_cancel_session(uuid, text) TO authenticated;

-- ─── 4. club_manager_get_team_members ────────────────────────────────────────
-- Returns active team members with optional is_session_guest flag when
-- p_session_id is provided. No audit write — read-only RPC.

CREATE OR REPLACE FUNCTION public.club_manager_get_team_members(
  p_team_id   uuid,
  p_session_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile_id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'profile_id',       mp.id,
        'first_name',       mp.first_name,
        'last_name',        mp.last_name,
        'is_session_guest', CASE
          WHEN p_session_id IS NOT NULL THEN EXISTS (
            SELECT 1 FROM public.club_session_guests csg
            WHERE csg.session_id = p_session_id AND csg.member_profile_id = mp.id
          )
          ELSE false
        END
      ) ORDER BY mp.first_name, mp.last_name
    )
    FROM public.club_team_members ctm
    JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
    WHERE ctm.team_id = p_team_id AND ctm.is_active = true
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_get_team_members(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_get_team_members(uuid, uuid) TO authenticated;

-- ─── 5. club_manager_add_session_guest ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_manager_add_session_guest(
  p_session_id      uuid,
  p_guest_profile_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile    record;
  v_session    record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_session FROM public.club_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_session.team_id IS NULL THEN RAISE EXCEPTION 'not_team_session' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = v_session.team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  IF v_session.status <> 'scheduled' THEN RAISE EXCEPTION 'session_not_scheduled' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.member_profiles WHERE id = p_guest_profile_id) THEN
    RAISE EXCEPTION 'guest_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_session_guests
    (session_id, member_profile_id, added_by_manager_profile_id)
  VALUES
    (p_session_id, p_guest_profile_id, v_profile.id)
  ON CONFLICT (session_id, member_profile_id) DO NOTHING;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'manager_guest_added', 'club_session_guests', p_session_id::text,
    jsonb_build_object('session_id', p_session_id, 'guest_profile_id', p_guest_profile_id,
                       'team_id', v_session.team_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_add_session_guest(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_add_session_guest(uuid, uuid) TO authenticated;

-- ─── 6. club_manager_remove_session_guest ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_manager_remove_session_guest(
  p_session_id       uuid,
  p_guest_profile_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile    record;
  v_session    record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_session FROM public.club_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_session.team_id IS NULL THEN RAISE EXCEPTION 'not_team_session' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = v_session.team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  DELETE FROM public.club_session_guests
  WHERE session_id = p_session_id AND member_profile_id = p_guest_profile_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'manager_guest_removed', 'club_session_guests', p_session_id::text,
    jsonb_build_object('session_id', p_session_id, 'guest_profile_id', p_guest_profile_id,
                       'team_id', v_session.team_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_remove_session_guest(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_remove_session_guest(uuid, uuid) TO authenticated;
