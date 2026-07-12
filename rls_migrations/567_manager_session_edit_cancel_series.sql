-- 567_manager_session_edit_cancel_series.sql
-- Manager booking calendar — Phase 1 (the two genuine write-path gaps).
--
-- The operator's requirement: bookings must be repeatable (already have
-- club_manager_book_pitch_series + club_manager_create_session_series), editable
-- (NEW), and cancellable individually (already have club_manager_cancel_session)
-- OR as a whole recurring block (NEW). This migration adds the two missing writes,
-- both MANAGER-gated (auth.uid() -> member_profiles -> active club_team_managers of
-- the session's team), both audited (Hard Rule #9), occupancy-safe by REUSING the
-- shipped tg_sync_club_session_occupancy trigger + _reserve_club_occupancy engine —
-- no new occupancy code.
--
-- ── club_manager_update_session — edit / reschedule / re-pitch a scheduled session
-- Occupancy is handled entirely by the existing AFTER-UPDATE trigger
-- (tg_sync_club_session_occupancy, live body): it fires on UPDATE OF
-- status,venue_id,playing_area_id,scheduled_at and, when status='scheduled' AND
-- playing_area_id NOT NULL AND pitch_status='allocated', recomputes the range from
-- COALESCE(duration_mins,60) and re-reserves via _reserve_club_occupancy (upsert on
-- (source_kind,source_id) → RE-POINTS the same occupancy row to the new slot; a
-- non-bumpable clash RAISEs slot_unavailable); in every other case it RELEASES the
-- occupancy. So editing is three cases:
--   (1) occupancy changed AND a pitch is set → assign the slot columns +
--       pitch_status='allocated' inside a savepoint; the trigger reserves. A caught
--       slot_unavailable rolls the edit back and returns {ok:false, reason:'slot_taken'}
--       (nothing mutated — the calendar only offers free slots, so this is the race guard).
--   (2) occupancy changed AND no pitch (retime a plain session, or REMOVE the pitch)
--       → assign the slot columns (playing_area_id NULL); the trigger releases any old
--       occupancy. pitch_status returns to 'allocated' (the plain-session convention:
--       all 16 live no-pitch sessions store 'allocated' = no "Pitch TBC" chip).
--   (3) details only (title/location/notes/capacity/meet_time) → DON'T touch the
--       occupancy columns, so the trigger never fires and a stable booking can't be
--       knocked out by a race on an unrelated edit.
-- Duration-only changes fall in case (1)/(2): duration_mins is NOT in the trigger's
-- UPDATE OF list, but we always (re)assign scheduled_at in those branches, which fires
-- the trigger and makes it recompute the range from the new duration.
--
-- ── club_manager_cancel_series — cancel the whole recurring block
-- Cancels every FUTURE, still-scheduled occurrence sharing the session's series_id
-- (or just the one session if it has no series). Each row's status→'cancelled' fires
-- the trigger once → releases that occurrence's occupancy. Mirrors club_manager_cancel_session.
--
-- Proof: ephemeral-verify (throwaway _e2e_ fixture, auto-rollback, leak 0) MUST show:
--   (1) retime a pitched session onto a FREE slot → occupancy moves, pitch_status stays 'allocated';
--   (2) retime onto a slot held by an outside hire → {ok:false,'slot_taken'}, session UNCHANGED, old occupancy intact;
--   (3) details-only edit of a pitched session → occupancy row untouched (same time_range);
--   (4) remove the pitch (clear) → occupancy released, playing_area_id NULL, pitch_status 'allocated';
--   (5) cancel a 3-week series → all 3 future occurrences 'cancelled', all 3 occupancies released;
--   (6) auth: unauthenticated / non-manager / other team's session all rejected.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. club_manager_update_session
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_manager_update_session(
  p_session_id      uuid,
  p_title           text        DEFAULT NULL,
  p_scheduled_at    timestamptz DEFAULT NULL,
  p_duration_mins   int         DEFAULT NULL,
  p_venue_id        text        DEFAULT NULL,
  p_playing_area_id uuid        DEFAULT NULL,
  p_location        text        DEFAULT NULL,
  p_notes           text        DEFAULT NULL,
  p_capacity        int         DEFAULT NULL,
  p_meet_time       timestamptz DEFAULT NULL,
  p_clear_pitch     boolean     DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_profile      record;
  v_session      record;
  v_new_title    text;
  v_new_sched    timestamptz;
  v_new_dur      int;
  v_new_venue    text;
  v_new_pitch    uuid;
  v_occ_change   boolean;
  v_pitch_status text;
BEGIN
  -- ── Auth: auth.uid() → member_profiles → active manager of the session's team ──
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

  -- ── Resolve the new values (NULL param = keep existing; p_clear_pitch = un-book) ──
  v_new_title := COALESCE(NULLIF(btrim(p_title), ''), v_session.title);
  v_new_sched := COALESCE(p_scheduled_at, v_session.scheduled_at);
  v_new_dur   := COALESCE(p_duration_mins, v_session.duration_mins, 60);
  IF p_clear_pitch THEN
    v_new_venue := NULL; v_new_pitch := NULL;
  ELSE
    v_new_venue := COALESCE(p_venue_id, v_session.venue_id);
    v_new_pitch := COALESCE(p_playing_area_id, v_session.playing_area_id);
  END IF;

  -- Never reschedule into the past (the calendar can surface earlier hours of today).
  IF v_new_sched <= now() THEN RAISE EXCEPTION 'session_in_past' USING ERRCODE = 'P0001'; END IF;
  IF v_new_dur < 1 OR v_new_dur > 1440 THEN RAISE EXCEPTION 'invalid_duration' USING ERRCODE = 'P0001'; END IF;
  IF v_new_pitch IS NOT NULL AND v_new_venue IS NULL THEN
    RAISE EXCEPTION 'venue_required_for_pitch' USING ERRCODE = 'P0001';
  END IF;
  IF v_new_pitch IS NOT NULL THEN
    IF NOT public._venue_in_club_operator(NULL, v_session.club_id, v_new_venue) THEN
      RAISE EXCEPTION 'venue_not_in_operator' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.playing_areas WHERE id = v_new_pitch AND venue_id = v_new_venue
    ) THEN
      RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_occ_change := (v_new_sched IS DISTINCT FROM v_session.scheduled_at)
               OR (v_new_pitch IS DISTINCT FROM v_session.playing_area_id)
               OR (v_new_venue IS DISTINCT FROM v_session.venue_id)
               OR (v_new_dur   IS DISTINCT FROM COALESCE(v_session.duration_mins, 60));
  v_pitch_status := v_session.pitch_status;

  -- A session tied to a PENDING bump proposal must be resolved via the bump card, not
  -- silently re-pitched here (that would orphan the proposal). Mirrors mig 563's withdraw
  -- guard. Details-only edits (no occupancy change) are fine and don't touch the proposal.
  IF v_occ_change AND EXISTS (
    SELECT 1 FROM public.pitch_bump_proposals
    WHERE event_kind = 'club_session' AND event_id = p_session_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'pending_bump_resolve_via_proposal' USING ERRCODE = 'P0001';
  END IF;

  IF v_occ_change AND v_new_pitch IS NOT NULL THEN
    -- Case 1: re-reserve at the new slot. Assign the trigger's watched columns +
    -- pitch_status='allocated' so it fires and reserves; a non-bumpable clash RAISEs
    -- slot_unavailable → savepoint rolls the whole edit back, nothing mutated.
    BEGIN
      UPDATE public.club_sessions SET
        title           = v_new_title,
        location        = COALESCE(p_location, location),
        notes           = COALESCE(p_notes, notes),
        capacity        = COALESCE(p_capacity, capacity),
        meet_time       = COALESCE(p_meet_time, meet_time),
        duration_mins   = v_new_dur,
        venue_id        = v_new_venue,
        playing_area_id = v_new_pitch,
        scheduled_at    = v_new_sched,
        pitch_status    = 'allocated',
        updated_at      = now()
      WHERE id = p_session_id;
      v_pitch_status := 'allocated';
    EXCEPTION WHEN OTHERS THEN
      -- The reserve raises 'slot_unavailable'; a TOCTOU race on the EXCLUDE constraint
      -- raises SQLSTATE 23P01. Both mean "that slot is taken" — return cleanly.
      IF SQLERRM = 'slot_unavailable' OR SQLSTATE = '23P01' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'slot_taken', 'session_id', p_session_id);
      END IF;
      RAISE;
    END;

  ELSIF v_occ_change THEN
    -- Case 2: occupancy changed but no pitch now (retime plain / remove pitch). Assign
    -- the watched columns so the trigger fires and RELEASES any old occupancy. No clash
    -- possible. pitch_status='allocated' = the plain-session convention (no "Pitch TBC").
    UPDATE public.club_sessions SET
      title           = v_new_title,
      location        = COALESCE(p_location, location),
      notes           = COALESCE(p_notes, notes),
      capacity        = COALESCE(p_capacity, capacity),
      meet_time       = COALESCE(p_meet_time, meet_time),
      duration_mins   = v_new_dur,
      venue_id        = v_new_venue,
      playing_area_id = v_new_pitch,
      scheduled_at    = v_new_sched,
      pitch_status    = 'allocated',
      updated_at      = now()
    WHERE id = p_session_id;
    v_pitch_status := 'allocated';

  ELSE
    -- Case 3: details only. Do NOT touch the occupancy columns — leaving them out of the
    -- SET clause means the UPDATE OF trigger never fires, so a stable booking can't be
    -- knocked out of its slot by a race during an unrelated title/notes edit.
    UPDATE public.club_sessions SET
      title     = v_new_title,
      location  = COALESCE(p_location, location),
      notes     = COALESCE(p_notes, notes),
      capacity  = COALESCE(p_capacity, capacity),
      meet_time = COALESCE(p_meet_time, meet_time),
      updated_at = now()
    WHERE id = p_session_id;
  END IF;

  -- ── Audit (Hard Rule #9) ──
  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'manager_session_edited', 'club_sessions', p_session_id::text,
    jsonb_build_object('team_id', v_session.team_id, 'club_id', v_session.club_id,
                       'scheduled_at', v_new_sched, 'venue_id', v_new_venue,
                       'playing_area_id', v_new_pitch, 'duration_mins', v_new_dur,
                       'occupancy_change', v_occ_change, 'pitch_status', v_pitch_status)
  );

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'pitch_status', v_pitch_status);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_update_session(uuid,text,timestamptz,int,text,uuid,text,text,int,timestamptz,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_update_session(uuid,text,timestamptz,int,text,uuid,text,text,int,timestamptz,boolean) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. club_manager_cancel_series — cancel every future occurrence of the block
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_manager_cancel_series(
  p_session_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   record;
  v_session   record;
  v_series    uuid;
  v_count     int;
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

  v_series := v_session.series_id;

  -- Cancel every FUTURE, still-scheduled occurrence of the block (or just this one if
  -- it has no series). Each status→'cancelled' fires tg_sync_club_session_occupancy
  -- once, releasing that occurrence's pitch occupancy.
  IF v_series IS NULL THEN
    UPDATE public.club_sessions SET
      status = 'cancelled', cancelled_reason = p_reason, updated_at = now()
    WHERE id = p_session_id AND status = 'scheduled' AND scheduled_at > now();
  ELSE
    UPDATE public.club_sessions SET
      status = 'cancelled', cancelled_reason = p_reason, updated_at = now()
    WHERE series_id = v_series AND team_id = v_session.team_id
      AND status = 'scheduled' AND scheduled_at > now();
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'manager_series_cancelled', 'club_session_series', COALESCE(v_series::text, p_session_id::text),
    jsonb_build_object('team_id', v_session.team_id, 'club_id', v_session.club_id,
                       'series_id', v_series, 'cancelled_count', v_count, 'reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true, 'series_id', v_series, 'cancelled_count', v_count);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_cancel_series(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_cancel_series(uuid,text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
