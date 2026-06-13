-- Migration 302 — Phase 10 Club Attendance: Slice 4C
-- New table: club_session_series
-- Column: club_sessions.series_id (nullable FK)
-- Admin RPCs (2): club_create_session_series, club_cancel_session_series
-- Extended RPCs (2): club_list_sessions (series_id + series_title),
--                    member_list_upcoming_sessions (4th arm: managers)
-- day_of_week convention: 0=Sun … 6=Sat (matches EXTRACT(DOW))

-- ─── 1. club_session_series ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.club_session_series (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  cohort_id    uuid        REFERENCES public.club_cohorts(id) ON DELETE SET NULL,
  team_id      uuid        REFERENCES public.club_teams(id) ON DELETE SET NULL,
  title        text        NOT NULL,
  session_type text        NOT NULL DEFAULT 'training'
    CHECK (session_type IN ('training', 'match', 'friendly', 'other')),
  day_of_week  int         NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   time        NOT NULL,
  from_date    date        NOT NULL,
  to_date      date        NOT NULL,
  location     text,
  notes        text,
  capacity     integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.club_session_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_session_series FROM anon, authenticated;

-- ─── 2. club_sessions.series_id ──────────────────────────────────────────────

ALTER TABLE public.club_sessions
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.club_session_series(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS club_sessions_series_id_idx ON public.club_sessions (series_id);

-- ─── 3. club_create_session_series ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_create_session_series(
  p_venue_token  text,
  p_club_id      text,
  p_title        text,
  p_session_type text,
  p_day_of_week  int,
  p_start_time   time,
  p_from_date    date,
  p_to_date      date,
  p_cohort_id    uuid    DEFAULT NULL,
  p_team_id      uuid    DEFAULT NULL,
  p_location     text    DEFAULT NULL,
  p_notes        text    DEFAULT NULL,
  p_capacity     integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
       v_series_id, (v_cursor + p_start_time)::timestamptz, p_location, p_notes, p_capacity);
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
$fn$;

REVOKE ALL ON FUNCTION public.club_create_session_series(text,text,text,text,int,time,date,date,uuid,uuid,text,text,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_create_session_series(text,text,text,text,int,time,date,date,uuid,uuid,text,text,integer) TO anon, authenticated;

-- ─── 4. club_cancel_session_series ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_cancel_session_series(
  p_venue_token text,
  p_series_id   uuid,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club_id  text;
  v_count    int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT css.club_id INTO v_club_id
  FROM public.club_session_series css
  JOIN public.club_venues cv ON cv.club_id = css.club_id AND cv.venue_id = v_venue_id
  WHERE css.id = p_series_id;

  IF v_club_id IS NULL THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.club_sessions SET
    status           = 'cancelled',
    cancelled_reason = p_reason,
    updated_at       = now()
  WHERE series_id = p_series_id
    AND status    = 'scheduled'
    AND scheduled_at > now();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_series_cancelled', 'club_session_series', p_series_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', v_club_id,
                             'reason', p_reason, 'sessions_cancelled', v_count));

  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id, 'sessions_cancelled', v_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_cancel_session_series(text,uuid,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_cancel_session_series(text,uuid,text) TO anon, authenticated;

-- ─── 5. club_list_sessions — add series_id + series_title ────────────────────

CREATE OR REPLACE FUNCTION public.club_list_sessions(
  p_venue_token text,
  p_club_id     text,
  p_cohort_id   uuid        DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'session_id',        cs.id,
        'club_id',           cs.club_id,
        'cohort_id',         cs.cohort_id,
        'cohort_name',       cc.name,
        'title',             cs.title,
        'scheduled_at',      cs.scheduled_at,
        'location',          cs.location,
        'notes',             cs.notes,
        'capacity',          cs.capacity,
        'status',            cs.status,
        'cancelled_reason',  cs.cancelled_reason,
        'series_id',         cs.series_id,
        'series_title',      css.title,
        'rsvp_in',           (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'in'),
        'rsvp_out',          (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'out'),
        'rsvp_maybe',        (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'maybe'),
        'attendance_marked', EXISTS (SELECT 1 FROM public.club_session_attendance a WHERE a.session_id = cs.id)
      ) ORDER BY cs.scheduled_at
    ), '[]'::jsonb)
    FROM public.club_sessions cs
    LEFT JOIN public.club_cohorts cc ON cc.id = cs.cohort_id
    LEFT JOIN public.club_session_series css ON css.id = cs.series_id
    WHERE cs.club_id = p_club_id
      AND (p_cohort_id IS NULL OR cs.cohort_id = p_cohort_id)
      AND (p_from IS NULL OR cs.scheduled_at >= p_from)
      AND (p_to   IS NULL OR cs.scheduled_at <= p_to)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_list_sessions(text,text,uuid,timestamptz,timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_list_sessions(text,text,uuid,timestamptz,timestamptz) TO anon, authenticated;

-- ─── 6. member_list_upcoming_sessions — 4th arm: managers ────────────────────

CREATE OR REPLACE FUNCTION public.member_list_upcoming_sessions(
  p_club_id    text,
  p_cohort_id  uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE club_id = p_club_id
      AND member_profile_id = v_profile_id
      AND status IN ('active', 'ending')
  ) THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'session_id',          cs.id,
        'club_id',             cs.club_id,
        'cohort_id',           cs.cohort_id,
        'cohort_name',         cc.name,
        'team_id',             cs.team_id,
        'title',               cs.title,
        'session_type',        cs.session_type,
        'scheduled_at',        cs.scheduled_at,
        'meet_time',           cs.meet_time,
        'location',            cs.location,
        'opponent_name',       cs.opponent_name,
        'home_away',           cs.home_away,
        'opponent_venue_name', cs.opponent_venue_name,
        'opponent_address',    cs.opponent_address,
        'notes',               cs.notes,
        'capacity',            cs.capacity,
        'own_rsvp_status',     r.status
      ) ORDER BY cs.scheduled_at
    )
    FROM public.club_sessions cs
    LEFT JOIN public.club_cohorts cc ON cc.id = cs.cohort_id
    LEFT JOIN public.club_session_rsvps r
           ON r.session_id = cs.id AND r.member_profile_id = v_profile_id
    WHERE cs.club_id = p_club_id
      AND cs.status = 'scheduled'
      AND cs.scheduled_at > now()
      AND (p_cohort_id IS NULL OR cs.cohort_id = p_cohort_id)
      AND (
        -- (a) whole-cohort session: caller has active membership for this cohort
        (cs.team_id IS NULL AND EXISTS (
          SELECT 1 FROM public.venue_memberships vm
          WHERE vm.club_id = p_club_id
            AND vm.member_profile_id = v_profile_id
            AND vm.status IN ('active', 'ending')
            AND (cs.cohort_id IS NULL OR vm.cohort_id = cs.cohort_id)
        ))
        OR
        -- (b) team-specific session: caller is an active player on that team
        (cs.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.club_team_members ctm
          WHERE ctm.team_id = cs.team_id
            AND ctm.member_profile_id = v_profile_id
            AND ctm.is_active = true
        ))
        OR
        -- (c) guest appearance
        EXISTS (
          SELECT 1 FROM public.club_session_guests csg
          WHERE csg.session_id = cs.id
            AND csg.member_profile_id = v_profile_id
        )
        OR
        -- (d) caller manages this team
        (cs.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.club_team_managers ctm
          WHERE ctm.team_id = cs.team_id
            AND ctm.member_profile_id = v_profile_id
            AND ctm.is_active = true
        ))
      )
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.member_list_upcoming_sessions(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.member_list_upcoming_sessions(text, uuid) TO authenticated;
