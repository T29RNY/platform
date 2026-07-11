-- 560_coach_book_pitch_request.sql
-- Coach self-service pitch booking — Phase 3a (PR #3, split): the WRITE path.
--
-- The defining new behaviour of the whole epic: a coach clash becomes a HELD
-- REQUEST, not a hard error. Two new SECURITY DEFINER RPCs, gated by
-- club_team_managers(is_active), that:
--   * create the club_session ALWAYS as status='scheduled' (so it is visible to
--     players + guardians and collects in/out from day one — the availability
--     ignition), then
--   * TRY to allocate the pitch (pitch_status='allocated' → the mig-558 trigger
--     reserves via _reserve_club_occupancy, bumping a worse-ranked club incumbent
--     for free), and
--   * on a non-bumpable clash (slot_unavailable) CATCH the error and leave the
--     session alive with pitch_status='requested' — holds no occupancy, but the
--     session still shows to players as "pitch being confirmed".
--
-- SCOPE (3a, deliberately minimal — split from 3b per operator 2026-07-11):
--   * NO change to any shipped function. _reserve_club_occupancy /
--     _apply_bump_resolution are UNTOUCHED here — a coach-triggered bump still
--     sends the worse-ranked incumbent to status='tentative' exactly as owner
--     bumps do today (migs 416-418). The bump-visibility rewrite (bumped session
--     stays scheduled + pitch_status) is PR #3b.
--   * NO notify_venue_change call — there is no venue-side coach-request inbox
--     until PR #5, and firing a realtime publisher with no matching subscriber
--     violates Hard Rule #10. The audit_events row (Hard Rule #9) is the durable
--     server-side trace. PR #5 adds the notify + its known-reason alongside the
--     inbox that consumes it.
--   * NO @platform/core wrapper / UI wiring — deferred to PR #4 (coach request
--     status UI). 3a is a DB-only increment, proven end-to-end by ephemeral-verify.
--
-- Mechanism note (why the session survives a clash): the reserve fires inside an
-- AFTER trigger that is attached `UPDATE OF status, venue_id, playing_area_id,
-- scheduled_at` — pitch_status is NOT in that column list, so a bare pitch_status
-- UPDATE never fires the reserve (verified against pg_get_triggerdef; do NOT
-- "simplify" this to insert-'none'-then-UPDATE-'allocated' — the reserve would
-- silently never run). We therefore INSERT the session directly with
-- pitch_status='allocated' inside a plpgsql sub-block (a savepoint): the INSERT
-- fires the trigger (empty→reserve, worse-ranked club incumbent→bump, non-bumpable
-- clash→RAISE slot_unavailable). A caught slot_unavailable rolls that INSERT fully
-- back; we re-INSERT the SAME pre-generated id with pitch_status='requested'
-- (status stays 'scheduled', reserves nothing) so the session stays visible.
-- Mirrors the shipped _apply_bump_resolution SQLERRM='slot_unavailable' catch (mig 417).
--
-- Proof: ephemeral-verify (throwaway _e2e_ fixture, auto-rollback) MUST show:
--   (1) empty slot        → pitch_status='allocated', occupancy reserved;
--   (2) better-rank clash  → pitch_status='allocated' (incumbent bumped);
--   (3) non-bumpable clash → pitch_status='requested', ZERO occupancy, NO error,
--       and the session STILL lists as status='scheduled';
--   (4) variable duration  → a 90-min book reserves a 90-min range;
--   (5) series             → free weeks allocate, the clashing week requests, the
--       run never rolls back whole (decision E);
--   (6) auth/authorization → unauthenticated, non-manager, non-linked venue,
--       pitch-not-in-venue, bad duration all rejected.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. club_manager_book_pitch — single booking, empty→allocate / clash→request
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_manager_book_pitch(
  p_team_id         uuid,
  p_venue_id        text,
  p_playing_area_id uuid,
  p_scheduled_at    timestamptz,
  p_title           text,
  p_session_type    text        DEFAULT 'training',
  p_duration_mins   int         DEFAULT 60,
  p_location        text        DEFAULT NULL,
  p_notes           text        DEFAULT NULL,
  p_capacity        int         DEFAULT NULL,
  p_meet_time       timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_profile      record;
  v_team         record;
  v_session_id   uuid;
  v_title        text := NULLIF(btrim(p_title), '');
  v_dur          int  := COALESCE(p_duration_mins, 60);
  v_pitch_status text := 'allocated';
BEGIN
  -- ── Auth: auth.uid() → member_profiles → active manager of this team ──
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  -- ── Input validation ──
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  IF p_scheduled_at IS NULL THEN RAISE EXCEPTION 'scheduled_at_required' USING ERRCODE = 'P0001'; END IF;
  IF p_venue_id IS NULL THEN RAISE EXCEPTION 'venue_required' USING ERRCODE = 'P0001'; END IF;
  IF p_playing_area_id IS NULL THEN RAISE EXCEPTION 'pitch_required' USING ERRCODE = 'P0001'; END IF;
  IF v_dur < 1 OR v_dur > 1440 THEN RAISE EXCEPTION 'invalid_duration' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_team FROM public.club_teams WHERE id = p_team_id;
  IF v_team.id IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;

  -- ── Venue must be a ground the coach's CLUB is linked to (any operator venue;
  --    mig-559-relaxed helper accepts standalone company_id-NULL clubs) ──
  IF NOT public._venue_in_club_operator(NULL, v_team.club_id, p_venue_id) THEN
    RAISE EXCEPTION 'venue_not_in_operator' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = p_venue_id
  ) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  -- ── Book the pitch. Pre-generate the id so it is stable whichever branch we
  --    take. INSERT with pitch_status='allocated' fires tg_sync_club_session_occupancy
  --    → _reserve_club_occupancy: an empty slot reserves; a worse-ranked club
  --    incumbent is bumped (coach books clean); a non-bumpable clash RAISEs
  --    slot_unavailable. The sub-block savepoint means a caught clash fully rolls
  --    back that INSERT — we then record the SAME session as a pending REQUEST,
  --    still status='scheduled' so it stays visible to players/guardians.
  --
  --    Why re-INSERT and not a pitch_status UPDATE: the trigger is attached
  --    `UPDATE OF status, venue_id, playing_area_id, scheduled_at` — pitch_status
  --    is NOT in that list, so a bare pitch_status UPDATE never fires the reserve.
  --    An INSERT always fires it (as club_manager_create_session relies on). ──
  v_session_id := gen_random_uuid();
  BEGIN
    INSERT INTO public.club_sessions
      (id, club_id, cohort_id, team_id, title, session_type, scheduled_at,
       location, notes, capacity, meet_time, venue_id, playing_area_id, status,
       pitch_status, booking_origin, booked_by_profile_id, duration_mins)
    VALUES
      (v_session_id, v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type, p_scheduled_at,
       p_location, p_notes, p_capacity, p_meet_time, p_venue_id, p_playing_area_id, 'scheduled',
       'allocated', 'coach', v_profile.id, v_dur);
    v_pitch_status := 'allocated';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'slot_unavailable' THEN
      INSERT INTO public.club_sessions
        (id, club_id, cohort_id, team_id, title, session_type, scheduled_at,
         location, notes, capacity, meet_time, venue_id, playing_area_id, status,
         pitch_status, booking_origin, booked_by_profile_id, duration_mins)
      VALUES
        (v_session_id, v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type, p_scheduled_at,
         p_location, p_notes, p_capacity, p_meet_time, p_venue_id, p_playing_area_id, 'scheduled',
         'requested', 'coach', v_profile.id, v_dur);
      v_pitch_status := 'requested';
    ELSE
      RAISE;
    END IF;
  END;

  -- ── Audit (Hard Rule #9) ──
  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'coach_pitch_booked', 'club_sessions', v_session_id::text,
    jsonb_build_object('team_id', p_team_id, 'club_id', v_team.club_id,
                       'venue_id', p_venue_id, 'playing_area_id', p_playing_area_id,
                       'scheduled_at', p_scheduled_at, 'duration_mins', v_dur,
                       'session_type', p_session_type, 'pitch_status', v_pitch_status)
  );

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id,
                            'pitch_status', v_pitch_status, 'session_type', p_session_type);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_book_pitch(uuid,text,uuid,timestamptz,text,text,int,text,text,int,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_book_pitch(uuid,text,uuid,timestamptz,text,text,int,text,text,int,timestamptz) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. club_manager_book_pitch_series — per-occurrence book-or-request (decision E)
--    Each week is booked or (on a clash) requested INDEPENDENTLY — one clashing
--    week never rolls back the whole run. Free weeks confirm immediately.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_manager_book_pitch_series(
  p_team_id         uuid,
  p_venue_id        text,
  p_playing_area_id uuid,
  p_title           text,
  p_day_of_week     int,
  p_start_time      time without time zone,
  p_from_date       date,
  p_to_date         date,
  p_session_type    text    DEFAULT 'training',
  p_duration_mins   int     DEFAULT 60,
  p_location        text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_capacity        int     DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile     record;
  v_team        record;
  v_series_id   uuid;
  v_title       text := NULLIF(btrim(p_title), '');
  v_dur         int  := COALESCE(p_duration_mins, 60);
  v_cursor      date;
  v_session_id  uuid;
  v_scheduled   timestamptz;
  v_pitch_status text;
  v_allocated   int  := 0;
  v_requested   int  := 0;
  v_weeks       jsonb := '[]'::jsonb;
BEGIN
  -- ── Auth ──
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  -- ── Validation ──
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  IF p_venue_id IS NULL THEN RAISE EXCEPTION 'venue_required' USING ERRCODE = 'P0001'; END IF;
  IF p_playing_area_id IS NULL THEN RAISE EXCEPTION 'pitch_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL THEN RAISE EXCEPTION 'dates_required' USING ERRCODE = 'P0001'; END IF;
  IF p_from_date > p_to_date THEN RAISE EXCEPTION 'from_after_to' USING ERRCODE = 'P0001'; END IF;
  IF p_day_of_week NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE = 'P0001'; END IF;
  IF v_dur < 1 OR v_dur > 1440 THEN RAISE EXCEPTION 'invalid_duration' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_team FROM public.club_teams WHERE id = p_team_id;
  IF v_team.id IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;

  IF NOT public._venue_in_club_operator(NULL, v_team.club_id, p_venue_id) THEN
    RAISE EXCEPTION 'venue_not_in_operator' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = p_venue_id
  ) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_session_series
    (club_id, cohort_id, team_id, title, session_type,
     day_of_week, start_time, from_date, to_date, location, notes, capacity, venue_id, playing_area_id)
  VALUES
    (v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type,
     p_day_of_week, p_start_time, p_from_date, p_to_date, p_location, p_notes, p_capacity, p_venue_id, p_playing_area_id)
  RETURNING id INTO v_series_id;

  -- first on-or-after from_date matching the requested weekday
  v_cursor := p_from_date + ((p_day_of_week - EXTRACT(DOW FROM p_from_date)::int + 7) % 7) * INTERVAL '1 day';

  WHILE v_cursor <= p_to_date LOOP
    v_scheduled := (v_cursor + p_start_time) AT TIME ZONE 'Europe/London';

    -- per-occurrence allocate-or-request; the savepoint isolates each week so one
    -- clashing week neither rolls back the run nor the other weeks. Pre-gen a
    -- stable id, INSERT with pitch_status='allocated' (the INSERT fires the reserve
    -- trigger — a bare pitch_status UPDATE would not; see single-RPC note above),
    -- and on a non-bumpable clash re-INSERT the same week as a pending REQUEST.
    v_session_id := gen_random_uuid();
    BEGIN
      INSERT INTO public.club_sessions
        (id, club_id, cohort_id, team_id, title, session_type,
         series_id, scheduled_at, location, notes, capacity, venue_id, playing_area_id, status,
         pitch_status, booking_origin, booked_by_profile_id, duration_mins)
      VALUES
        (v_session_id, v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type,
         v_series_id, v_scheduled, p_location, p_notes, p_capacity, p_venue_id, p_playing_area_id, 'scheduled',
         'allocated', 'coach', v_profile.id, v_dur);
      v_pitch_status := 'allocated';
      v_allocated := v_allocated + 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'slot_unavailable' THEN
        INSERT INTO public.club_sessions
          (id, club_id, cohort_id, team_id, title, session_type,
           series_id, scheduled_at, location, notes, capacity, venue_id, playing_area_id, status,
           pitch_status, booking_origin, booked_by_profile_id, duration_mins)
        VALUES
          (v_session_id, v_team.club_id, v_team.cohort_id, p_team_id, v_title, p_session_type,
           v_series_id, v_scheduled, p_location, p_notes, p_capacity, p_venue_id, p_playing_area_id, 'scheduled',
           'requested', 'coach', v_profile.id, v_dur);
        v_pitch_status := 'requested';
        v_requested := v_requested + 1;
      ELSE
        RAISE;
      END IF;
    END;

    v_weeks := v_weeks || jsonb_build_object(
      'session_id', v_session_id, 'scheduled_at', v_scheduled, 'pitch_status', v_pitch_status);
    v_cursor := v_cursor + INTERVAL '7 days';
  END LOOP;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'coach_pitch_series_booked', 'club_session_series', v_series_id::text,
    jsonb_build_object('team_id', p_team_id, 'club_id', v_team.club_id,
                       'venue_id', p_venue_id, 'playing_area_id', p_playing_area_id,
                       'day_of_week', p_day_of_week, 'duration_mins', v_dur,
                       'allocated', v_allocated, 'requested', v_requested)
  );

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id,
                            'sessions_created', v_allocated + v_requested,
                            'allocated_count', v_allocated, 'requested_count', v_requested,
                            'weeks', v_weeks);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_book_pitch_series(uuid,text,uuid,text,int,time,date,date,text,int,text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_book_pitch_series(uuid,text,uuid,text,int,time,date,date,text,int,text,text,int) TO authenticated;

-- PostgREST schema cache refresh (new function signatures)
SELECT pg_notify('pgrst', 'reload schema');
