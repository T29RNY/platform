-- Migration 412 — Multi-venue (pilot #7) Phase 1: venue-anchor club SESSIONS.
--
-- Same-operator only: a club runs >1 venue under ONE operator (venues.company_id),
-- training AND matches at either site, venue chosen per-activity. The access layer
-- (membership/features/teams across the club's venues) shipped mig 401; this anchors
-- each SESSION to the right site so members see the correct venue+address and the
-- right venue console/reception picks it up.
--
-- 1. club_sessions (+ club_session_series) gain venue_id (FK→venues, nullable) and
--    playing_area_id (FK→playing_areas, nullable). Backfilled to each club's CURRENT
--    SINGLE club_venues venue (today every club has exactly 1 venue → byte-identical;
--    only multi-venue clubs are left NULL, of which there are none yet).
-- 2. NEW shared guard _venue_in_club_operator(caller_venue_id, club_id, target_venue_id)
--    — target ∈ club_venues(club) AND venues.company_id non-null AND (caller NULL [a
--    manager, no venue token] OR target.company = caller.company). The same-operator seam.
-- 3. The 5 session write RPCs gain p_venue_id (+ p_playing_area_id), validated via the
--    guard (+ pitch ∈ venue). Old overloads DROPped, re-granted. Audit writes preserved.
-- 4. Readers member_list_upcoming_sessions + club_list_sessions return venue_id/name/
--    address; venue_list_club_venues extended additively (+company_id, +playing_areas[])
--    to feed the venue + pitch pickers. All additive — CREATE OR REPLACE preserves grants.

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.club_sessions
  ADD COLUMN IF NOT EXISTS venue_id        text REFERENCES public.venues(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS playing_area_id uuid REFERENCES public.playing_areas(id) ON DELETE SET NULL;

ALTER TABLE public.club_session_series
  ADD COLUMN IF NOT EXISTS venue_id        text REFERENCES public.venues(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS playing_area_id uuid REFERENCES public.playing_areas(id) ON DELETE SET NULL;

-- ─── 2. Backfill to each club's single current venue (multi-venue clubs left NULL) ──
UPDATE public.club_sessions cs
SET venue_id = cv.venue_id
FROM public.club_venues cv
WHERE cv.club_id = cs.club_id
  AND cs.venue_id IS NULL
  AND (SELECT count(*) FROM public.club_venues x WHERE x.club_id = cs.club_id) = 1;

UPDATE public.club_session_series css
SET venue_id = cv.venue_id
FROM public.club_venues cv
WHERE cv.club_id = css.club_id
  AND css.venue_id IS NULL
  AND (SELECT count(*) FROM public.club_venues x WHERE x.club_id = css.club_id) = 1;

-- ─── 3. Same-operator guard (internal, reused by Phase 2 fixtures) ────────────
CREATE OR REPLACE FUNCTION public._venue_in_club_operator(
  p_caller_venue_id text,   -- NULL for non-venue callers (a club manager, auth.uid()-only)
  p_club_id         text,
  p_target_venue_id text
) RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.club_venues cv
    JOIN public.venues tv ON tv.id = cv.venue_id
    WHERE cv.club_id    = p_club_id
      AND cv.venue_id   = p_target_venue_id
      AND tv.company_id IS NOT NULL
      AND (
        p_caller_venue_id IS NULL
        OR tv.company_id = (SELECT company_id FROM public.venues WHERE id = p_caller_venue_id)
      )
  );
$fn$;
REVOKE ALL     ON FUNCTION public._venue_in_club_operator(text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public._venue_in_club_operator(text, text, text) FROM anon, authenticated;

-- ─── 4. club_create_session (venue token) — gains p_venue_id, p_playing_area_id ──
DROP FUNCTION IF EXISTS public.club_create_session(text,text,text,timestamptz,uuid,text,text,integer);
CREATE OR REPLACE FUNCTION public.club_create_session(
  p_venue_token     text,
  p_club_id         text,
  p_title           text,
  p_scheduled_at    timestamptz,
  p_cohort_id       uuid    DEFAULT NULL,
  p_location        text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_capacity        integer DEFAULT NULL,
  p_venue_id        text    DEFAULT NULL,
  p_playing_area_id uuid    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_session_id uuid;
  v_title      text := NULLIF(btrim(p_title), '');
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
  IF p_scheduled_at IS NULL THEN RAISE EXCEPTION 'scheduled_at_required' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_cohorts WHERE id = p_cohort_id AND club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- Multi-venue: the chosen site must be one of the club's same-operator venues.
  IF p_playing_area_id IS NOT NULL AND p_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue_required_for_pitch' USING ERRCODE = 'P0001';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT public._venue_in_club_operator(v_venue_id, p_club_id, p_venue_id) THEN
      RAISE EXCEPTION 'venue_not_in_operator' USING ERRCODE = 'P0001';
    END IF;
    IF p_playing_area_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = p_venue_id
    ) THEN
      RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.club_sessions
    (club_id, cohort_id, title, scheduled_at, location, notes, capacity, venue_id, playing_area_id)
  VALUES
    (p_club_id, p_cohort_id, v_title, p_scheduled_at, p_location, p_notes, p_capacity, p_venue_id, p_playing_area_id)
  RETURNING id INTO v_session_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_session_created', 'club_session', v_session_id::text,
          jsonb_build_object('club_id', p_club_id, 'title', v_title,
                             'scheduled_at', p_scheduled_at, 'venue_id', p_venue_id));
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_create_session(text,text,text,timestamptz,uuid,text,text,integer,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_create_session(text,text,text,timestamptz,uuid,text,text,integer,text,uuid) TO anon, authenticated;

-- ─── 5. club_update_session (venue token) — gains p_venue_id, p_playing_area_id ──
DROP FUNCTION IF EXISTS public.club_update_session(text,uuid,text,timestamptz,text,text,integer);
CREATE OR REPLACE FUNCTION public.club_update_session(
  p_venue_token     text,
  p_session_id      uuid,
  p_title           text        DEFAULT NULL,
  p_scheduled_at    timestamptz DEFAULT NULL,
  p_location        text        DEFAULT NULL,
  p_notes           text        DEFAULT NULL,
  p_capacity        integer     DEFAULT NULL,
  p_venue_id        text        DEFAULT NULL,
  p_playing_area_id uuid        DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_club_id    text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  -- Ownership (session → club → caller's club_venues) + club for venue validation.
  SELECT cs.club_id INTO v_club_id
  FROM public.club_sessions cs
  JOIN public.club_venues cv ON cv.club_id = cs.club_id AND cv.venue_id = v_venue_id
  WHERE cs.id = p_session_id AND cs.status = 'scheduled';
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  IF p_playing_area_id IS NOT NULL AND p_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue_required_for_pitch' USING ERRCODE = 'P0001';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT public._venue_in_club_operator(v_venue_id, v_club_id, p_venue_id) THEN
      RAISE EXCEPTION 'venue_not_in_operator' USING ERRCODE = 'P0001';
    END IF;
    IF p_playing_area_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = p_venue_id
    ) THEN
      RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.club_sessions cs SET
    title           = COALESCE(NULLIF(btrim(p_title), ''), cs.title),
    scheduled_at    = COALESCE(p_scheduled_at, cs.scheduled_at),
    location        = COALESCE(p_location, cs.location),
    notes           = COALESCE(p_notes, cs.notes),
    capacity        = COALESCE(p_capacity, cs.capacity),
    venue_id        = COALESCE(p_venue_id, cs.venue_id),
    -- Changing venue without naming a pitch clears the (now-stale) pitch.
    playing_area_id = CASE WHEN p_venue_id IS NOT NULL THEN p_playing_area_id
                           ELSE COALESCE(p_playing_area_id, cs.playing_area_id) END,
    updated_at      = now()
  WHERE cs.id = p_session_id AND cs.status = 'scheduled'
  RETURNING cs.id INTO v_session_id;

  IF v_session_id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_session_updated', 'club_session', v_session_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'new_venue_id', p_venue_id));
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_update_session(text,uuid,text,timestamptz,text,text,integer,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_update_session(text,uuid,text,timestamptz,text,text,integer,text,uuid) TO anon, authenticated;

-- ─── 6. club_create_session_series (venue token) — gains p_venue_id, p_playing_area_id ──
DROP FUNCTION IF EXISTS public.club_create_session_series(text,text,text,text,integer,time,date,date,uuid,uuid,text,text,integer);
CREATE OR REPLACE FUNCTION public.club_create_session_series(
  p_venue_token     text,
  p_club_id         text,
  p_title           text,
  p_session_type    text,
  p_day_of_week     integer,
  p_start_time      time without time zone,
  p_from_date       date,
  p_to_date         date,
  p_cohort_id       uuid    DEFAULT NULL,
  p_team_id         uuid    DEFAULT NULL,
  p_location        text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_capacity        integer DEFAULT NULL,
  p_venue_id        text    DEFAULT NULL,
  p_playing_area_id uuid    DEFAULT NULL
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
  IF p_playing_area_id IS NOT NULL AND p_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue_required_for_pitch' USING ERRCODE = 'P0001';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT public._venue_in_club_operator(v_venue_id, p_club_id, p_venue_id) THEN
      RAISE EXCEPTION 'venue_not_in_operator' USING ERRCODE = 'P0001';
    END IF;
    IF p_playing_area_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = p_venue_id
    ) THEN
      RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.club_session_series
    (club_id, cohort_id, team_id, title, session_type,
     day_of_week, start_time, from_date, to_date, location, notes, capacity, venue_id, playing_area_id)
  VALUES
    (p_club_id, p_cohort_id, p_team_id, v_title, p_session_type,
     p_day_of_week, p_start_time, p_from_date, p_to_date, p_location, p_notes, p_capacity, p_venue_id, p_playing_area_id)
  RETURNING id INTO v_series_id;

  v_cursor := p_from_date + ((p_day_of_week - EXTRACT(DOW FROM p_from_date)::int + 7) % 7) * INTERVAL '1 day';

  WHILE v_cursor <= p_to_date LOOP
    INSERT INTO public.club_sessions
      (club_id, cohort_id, team_id, title, session_type,
       series_id, scheduled_at, location, notes, capacity, venue_id, playing_area_id)
    VALUES
      (p_club_id, p_cohort_id, p_team_id, v_title, p_session_type,
       v_series_id, (v_cursor + p_start_time) AT TIME ZONE 'Europe/London', p_location, p_notes, p_capacity,
       p_venue_id, p_playing_area_id);
    v_count  := v_count + 1;
    v_cursor := v_cursor + INTERVAL '7 days';
  END LOOP;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_series_created', 'club_session_series', v_series_id::text,
          jsonb_build_object('club_id', p_club_id, 'title', v_title,
                             'day_of_week', p_day_of_week, 'sessions_created', v_count, 'venue_id', p_venue_id));

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'sessions_created', v_count);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_create_session_series(text,text,text,text,integer,time,date,date,uuid,uuid,text,text,integer,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_create_session_series(text,text,text,text,integer,time,date,date,uuid,uuid,text,text,integer,text,uuid) TO anon, authenticated;

-- ─── 7. club_manager_create_session (manager, auth.uid()) — gains p_venue_id, p_playing_area_id ──
DROP FUNCTION IF EXISTS public.club_manager_create_session(uuid,text,timestamptz,text,text,text,integer,timestamptz,text,text,text,text);
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
  p_opponent_address    text        DEFAULT NULL,
  p_venue_id            text        DEFAULT NULL,
  p_playing_area_id     uuid        DEFAULT NULL
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

  -- Multi-venue: a manager (no venue token) anchors to any of the club's same-operator venues.
  IF p_playing_area_id IS NOT NULL AND p_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue_required_for_pitch' USING ERRCODE = 'P0001';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT public._venue_in_club_operator(NULL, v_team.club_id, p_venue_id) THEN
      RAISE EXCEPTION 'venue_not_in_operator' USING ERRCODE = 'P0001';
    END IF;
    IF p_playing_area_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = p_venue_id
    ) THEN
      RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.club_sessions
    (club_id, cohort_id, team_id, title, session_type, scheduled_at,
     location, notes, capacity, meet_time, opponent_name, home_away,
     opponent_venue_name, opponent_address, venue_id, playing_area_id, status)
  VALUES
    (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type, p_scheduled_at,
     p_location, p_notes, p_capacity, p_meet_time, p_opponent_name, p_home_away,
     p_opponent_venue_name, p_opponent_address, p_venue_id, p_playing_area_id, 'scheduled')
  RETURNING id INTO v_session_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'manager_session_created', 'club_sessions', v_session_id::text,
    jsonb_build_object('team_id', p_team_id, 'club_id', v_team.club_id,
                       'title', v_title, 'scheduled_at', p_scheduled_at, 'venue_id', p_venue_id)
  );

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_create_session(uuid,text,timestamptz,text,text,text,integer,timestamptz,text,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_create_session(uuid,text,timestamptz,text,text,text,integer,timestamptz,text,text,text,text,text,uuid) TO authenticated;

-- ─── 8. club_manager_create_session_series (manager, auth.uid()) — gains p_venue_id, p_playing_area_id ──
DROP FUNCTION IF EXISTS public.club_manager_create_session_series(uuid,text,integer,time,date,date,text,text,text,integer);
CREATE OR REPLACE FUNCTION public.club_manager_create_session_series(
  p_team_id         uuid,
  p_title           text,
  p_day_of_week     integer,
  p_start_time      time without time zone,
  p_from_date       date,
  p_to_date         date,
  p_session_type    text    DEFAULT 'training',
  p_location        text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_capacity        integer DEFAULT NULL,
  p_venue_id        text    DEFAULT NULL,
  p_playing_area_id uuid    DEFAULT NULL
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

  IF p_playing_area_id IS NOT NULL AND p_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue_required_for_pitch' USING ERRCODE = 'P0001';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT public._venue_in_club_operator(NULL, v_team.club_id, p_venue_id) THEN
      RAISE EXCEPTION 'venue_not_in_operator' USING ERRCODE = 'P0001';
    END IF;
    IF p_playing_area_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = p_venue_id
    ) THEN
      RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.club_session_series
    (club_id, cohort_id, team_id, title, session_type,
     day_of_week, start_time, from_date, to_date, location, notes, capacity, venue_id, playing_area_id)
  VALUES
    (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type,
     p_day_of_week, p_start_time, p_from_date, p_to_date, p_location, p_notes, p_capacity, p_venue_id, p_playing_area_id)
  RETURNING id INTO v_series_id;

  v_cursor := p_from_date + ((p_day_of_week - EXTRACT(DOW FROM p_from_date)::int + 7) % 7) * INTERVAL '1 day';

  WHILE v_cursor <= p_to_date LOOP
    INSERT INTO public.club_sessions
      (club_id, cohort_id, team_id, title, session_type,
       series_id, scheduled_at, location, notes, capacity, venue_id, playing_area_id, status)
    VALUES
      (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type,
       v_series_id, (v_cursor + p_start_time) AT TIME ZONE 'Europe/London', p_location, p_notes, p_capacity,
       p_venue_id, p_playing_area_id, 'scheduled');
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
                       'sessions_created', v_count, 'venue_id', p_venue_id)
  );

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'sessions_created', v_count);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_create_session_series(uuid,text,integer,time,date,date,text,text,text,integer,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_create_session_series(uuid,text,integer,time,date,date,text,text,text,integer,text,uuid) TO authenticated;

-- ─── 9. Reader: member_list_upcoming_sessions — + venue_id/venue_name/venue_address ──
CREATE OR REPLACE FUNCTION public.member_list_upcoming_sessions(p_club_id text, p_cohort_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
        'venue_id',            cs.venue_id,
        'venue_name',          v.name,
        'venue_address',       NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
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
    LEFT JOIN public.venues v ON v.id = cs.venue_id
    LEFT JOIN public.club_session_rsvps r
           ON r.session_id = cs.id AND r.member_profile_id = v_profile_id
    WHERE cs.club_id = p_club_id
      AND cs.status = 'scheduled'
      AND cs.scheduled_at > now()
      AND (p_cohort_id IS NULL OR cs.cohort_id = p_cohort_id)
      AND (
        (cs.team_id IS NULL AND EXISTS (
          SELECT 1 FROM public.venue_memberships vm
          WHERE vm.club_id = p_club_id
            AND vm.member_profile_id = v_profile_id
            AND vm.status IN ('active', 'ending')
            AND (cs.cohort_id IS NULL OR vm.cohort_id = cs.cohort_id)
        ))
        OR
        (cs.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.club_team_members ctm
          WHERE ctm.team_id = cs.team_id
            AND ctm.member_profile_id = v_profile_id
            AND ctm.is_active = true
        ))
        OR
        EXISTS (
          SELECT 1 FROM public.club_session_guests csg
          WHERE csg.session_id = cs.id
            AND csg.member_profile_id = v_profile_id
        )
        OR
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

-- ─── 10. Reader: club_list_sessions (venue console) — + venue_id/venue_name/venue_address ──
CREATE OR REPLACE FUNCTION public.club_list_sessions(
  p_venue_token text, p_club_id text, p_cohort_id uuid DEFAULT NULL::uuid,
  p_from timestamptz DEFAULT NULL::timestamptz, p_to timestamptz DEFAULT NULL::timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
        'venue_id',          cs.venue_id,
        'venue_name',        v.name,
        'venue_address',     NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
        'playing_area_id',   cs.playing_area_id,
        'playing_area_name', pa.name,
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
    LEFT JOIN public.venues v ON v.id = cs.venue_id
    LEFT JOIN public.playing_areas pa ON pa.id = cs.playing_area_id
    WHERE cs.club_id = p_club_id
      AND (p_cohort_id IS NULL OR cs.cohort_id = p_cohort_id)
      AND (p_from IS NULL OR cs.scheduled_at >= p_from)
      AND (p_to   IS NULL OR cs.scheduled_at <= p_to)
  );
END;
$fn$;

-- ─── 11. Reader: venue_list_club_venues — + company_id and playing_areas[] (picker feed) ──
CREATE OR REPLACE FUNCTION public.venue_list_club_venues(p_venue_token text, p_club_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'not_club_venue' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'venues', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'venue_id',        v.id,
        'venue_name',      v.name,
        'city',            v.city,
        'company_id',      v.company_id,
        'is_self',         (v.id = v_venue_id),
        'playing_areas',   (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name)
                           ORDER BY pa.sort_order, pa.name) FILTER (WHERE pa.active), '[]'::jsonb)
          FROM public.playing_areas pa WHERE pa.venue_id = v.id
        ),
        'recent_checkins', (
          SELECT count(*)
            FROM public.venue_member_checkins vmc
            JOIN public.venue_memberships vm ON vm.id = vmc.membership_id
           WHERE vmc.venue_id = v.id
             AND vm.club_id = p_club_id
             AND vmc.checked_in_at > now() - interval '30 days'
        )
      ) ORDER BY v.name), '[]'::jsonb)
      FROM public.club_venues cv
      JOIN public.venues v ON v.id = cv.venue_id
      WHERE cv.club_id = p_club_id
    )
  );
END;
$fn$;

-- Schema cache refresh (PostgREST serves stale signatures after overload changes).
SELECT pg_notify('pgrst', 'reload schema');
