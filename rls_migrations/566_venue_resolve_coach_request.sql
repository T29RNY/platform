-- 566_venue_resolve_coach_request.sql
-- Coach self-service pitch booking — PR #5: the venue owner APPROVES / DECLINES a coach's
-- pitch REQUEST from their console. The loop-closer.
--
-- A coach books a pitch as a club_session; a non-bumpable clash is held as
-- pitch_status='requested' (holds NO pitch_occupancy). This adds the owner's side:
--   * venue_list_coach_requests  — the venue-wide inbox of requested club_sessions
--     (operator-scoped; NOT in the occupancy grid because 'requested' reserves nothing).
--   * venue_approve_coach_request — re-run the reserve. The occupancy trigger is attached
--     UPDATE OF status,venue_id,playing_area_id,scheduled_at — pitch_status is NOT in that
--     list, so a bare pitch_status UPDATE never fires the reserve. We therefore UPDATE
--     pitch_status='allocated' AND self-assign scheduled_at=scheduled_at (a listed column
--     in the SET list → the UPDATE OF trigger fires even though the value is unchanged —
--     documented Postgres behaviour). The trigger's _reserve_club_occupancy then reserves,
--     bumping a worse-ranked club incumbent if warranted. If the slot is STILL taken by a
--     non-bumpable holder (external hire / equal-or-better club team) it RAISEs
--     slot_unavailable inside the savepoint → the flip rolls back, the session stays
--     'requested', and we return {ok:false, reason:'slot_taken'}. We NEVER auto-evict a
--     paying hire (locked epic decision) — the owner clears the blocker or declines.
--   * venue_decline_coach_request — pitch_status='requested'→'none' ("pitch TBC"); the
--     session stays scheduled + keeps its RSVPs, the coach re-picks.
--   * _notify_coach_request — mirror _notify_bump (mig 417): a team-scoped club_announcement
--     (polled + email/push via clubBroadcastJob; NO realtime → no new subscriber, HR#10) +
--     audit_events (HR#9).
--
-- Auth: resolve_venue_caller(p_venue_token) + _venue_has_cap('manage_facility') on the
-- writes (mirrors venue_resolve_bump, mig 417); operator-scoped to the session's venue
-- (same venue OR same company_id). Reader mirrors venue_list_bump_proposals (token only).
--
-- Proof: ephemeral-verify (_e2e_ fixture, auto-rollback, leak 0) MUST show:
--   (1) approve an EMPTY-slot request → pitch_status='allocated', occupancy reserved;
--   (2) approve a STILL-CLASHING request (active external occupancy) → {ok:false,
--       slot_taken}, session stays 'requested', no occupancy reserved;
--   (3) decline → pitch_status='none', no occupancy, coach-notification announcement row;
--   (4) reader lists the operator's requested sessions, scoped;
--   (5) invalid token / insufficient cap / wrong-operator venue all rejected.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. _notify_coach_request — coach announcement + audit (mirrors _notify_bump)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_coach_request(p_session_id uuid, p_outcome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  s        record;
  v_team   text;
  v_pitch  text;
  v_venue  text;
  v_title  text;
  v_body   text;
BEGIN
  SELECT cs.id, cs.club_id, cs.team_id, cs.venue_id, cs.playing_area_id, cs.scheduled_at,
         cs.title
    INTO s
    FROM public.club_sessions cs WHERE cs.id = p_session_id;
  IF s.id IS NULL THEN RETURN; END IF;

  SELECT name INTO v_team FROM public.club_teams WHERE id = s.team_id;
  SELECT pa.name, v.name INTO v_pitch, v_venue
    FROM public.playing_areas pa JOIN public.venues v ON v.id = pa.venue_id
    WHERE pa.id = s.playing_area_id;

  IF p_outcome = 'approved' THEN
    v_title := 'Pitch confirmed';
    v_body  := COALESCE(v_team,'Your team') || '''s pitch is confirmed — ' || COALESCE(v_pitch,'the pitch')
               || ' at ' || COALESCE(v_venue,'the venue') || ', '
               || to_char(s.scheduled_at AT TIME ZONE 'Europe/London', 'Dy DD Mon HH24:MI') || '.';
  ELSE
    v_title := 'Pitch request declined';
    v_body  := COALESCE(v_team,'Your team') || '''s pitch request for '
               || to_char(s.scheduled_at AT TIME ZONE 'Europe/London', 'Dy DD Mon HH24:MI')
               || ' was declined by the venue. The session is still on — pick another pitch.';
  END IF;

  IF s.venue_id IS NOT NULL THEN
    INSERT INTO public.club_announcements (club_id, venue_id, created_by, title, body, audience, cohort_id, team_id)
    VALUES (s.club_id, s.venue_id, NULL, v_title, v_body, 'team', NULL, s.team_id);
  END IF;

  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', NULL, 'system', 'coach_pitch_request', 'coach_pitch_request_' || p_outcome, 'club_sessions', p_session_id::text,
    jsonb_build_object('team_id', s.team_id, 'club_id', s.club_id, 'venue_id', s.venue_id,
                       'playing_area_id', s.playing_area_id, 'outcome', p_outcome));
END;
$fn$;
REVOKE ALL     ON FUNCTION public._notify_coach_request(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._notify_coach_request(uuid, text) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. venue_list_coach_requests — operator-scoped inbox of requested club_sessions
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.venue_list_coach_requests(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_company text;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT company_id INTO v_company FROM public.venues WHERE id = v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id',   cs.id,
    'title',        cs.title,
    'session_type', cs.session_type,
    'club_id',      cs.club_id,
    'club_name',    cl.name,
    'team_id',      cs.team_id,
    'team_name',    ct.name,
    'venue_id',     cs.venue_id,
    'venue_name',   v.name,
    'pitch_name',   pa.name,
    'scheduled_at', cs.scheduled_at,
    'duration_mins', cs.duration_mins,
    'requested_by', NULLIF(btrim(concat_ws(' ', mp.first_name, mp.last_name)), '')
  ) ORDER BY cs.scheduled_at), '[]'::jsonb) INTO v_result
  FROM public.club_sessions cs
  JOIN public.venues v ON v.id = cs.venue_id
  LEFT JOIN public.clubs cl ON cl.id = cs.club_id
  LEFT JOIN public.club_teams ct ON ct.id = cs.team_id
  LEFT JOIN public.playing_areas pa ON pa.id = cs.playing_area_id
  LEFT JOIN public.member_profiles mp ON mp.id = cs.booked_by_profile_id
  WHERE cs.pitch_status = 'requested'
    AND cs.status = 'scheduled'
    -- ONLY genuine coach clash-requests: exclude owner-bumped sessions (mig 561 also sets
    -- pitch_status='requested', but those are resolved via the bump card, not this inbox).
    AND cs.booking_origin = 'coach'
    AND NOT EXISTS (SELECT 1 FROM public.pitch_bump_proposals bp
                    WHERE bp.event_kind = 'club_session' AND bp.event_id = cs.id AND bp.status = 'pending')
    AND (v.id = v_caller.venue_id OR (v_company IS NOT NULL AND v.company_id = v_company));

  RETURN jsonb_build_object('ok', true, 'requests', v_result);
END;
$fn$;
REVOKE ALL     ON FUNCTION public.venue_list_coach_requests(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_list_coach_requests(text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. venue_approve_coach_request — re-run the reserve (self-assign to fire the trigger)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.venue_approve_coach_request(p_venue_token text, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_company text;
  s         record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT cs.id, cs.venue_id, cs.pitch_status INTO s
    FROM public.club_sessions cs WHERE cs.id = p_session_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT company_id INTO v_company FROM public.venues WHERE id = v_caller.venue_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.venues v
    WHERE v.id = s.venue_id AND (v.id = v_caller.venue_id OR (v_company IS NOT NULL AND v.company_id = v_company))
  ) THEN RAISE EXCEPTION 'session_not_in_operator' USING ERRCODE = 'P0001'; END IF;

  IF s.pitch_status <> 'requested' THEN
    RAISE EXCEPTION 'not_a_pending_request' USING ERRCODE = 'P0001';
  END IF;

  -- A session with a pending bump proposal is a bump case (mig 561), not a coach request —
  -- resolve it via the bump card (venue_resolve_bump), never here (else the proposal orphans).
  IF EXISTS (SELECT 1 FROM public.pitch_bump_proposals bp
             WHERE bp.event_kind = 'club_session' AND bp.event_id = p_session_id AND bp.status = 'pending') THEN
    RAISE EXCEPTION 'pending_bump_resolve_via_proposal' USING ERRCODE = 'P0001';
  END IF;

  -- Re-run the reserve. Self-assign scheduled_at (a trigger UPDATE-OF column) so the
  -- occupancy trigger fires on the pitch_status flip. A non-bumpable re-clash raises
  -- slot_unavailable inside this savepoint → the flip rolls back, session stays 'requested'.
  BEGIN
    UPDATE public.club_sessions
      SET pitch_status = 'allocated', scheduled_at = scheduled_at
      WHERE id = p_session_id AND pitch_status = 'requested';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'slot_unavailable' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'slot_taken', 'pitch_status', 'requested');
    END IF;
    RAISE;
  END;

  PERFORM public._notify_coach_request(p_session_id, 'approved');

  RETURN jsonb_build_object('ok', true, 'pitch_status', 'allocated');
END;
$fn$;
REVOKE ALL     ON FUNCTION public.venue_approve_coach_request(text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_approve_coach_request(text, uuid) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. venue_decline_coach_request — pitch_status 'requested' → 'none' (pitch TBC)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.venue_decline_coach_request(p_venue_token text, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_company text;
  s         record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT cs.id, cs.venue_id, cs.pitch_status INTO s
    FROM public.club_sessions cs WHERE cs.id = p_session_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT company_id INTO v_company FROM public.venues WHERE id = v_caller.venue_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.venues v
    WHERE v.id = s.venue_id AND (v.id = v_caller.venue_id OR (v_company IS NOT NULL AND v.company_id = v_company))
  ) THEN RAISE EXCEPTION 'session_not_in_operator' USING ERRCODE = 'P0001'; END IF;

  IF s.pitch_status <> 'requested' THEN
    RAISE EXCEPTION 'not_a_pending_request' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pitch_bump_proposals bp
             WHERE bp.event_kind = 'club_session' AND bp.event_id = p_session_id AND bp.status = 'pending') THEN
    RAISE EXCEPTION 'pending_bump_resolve_via_proposal' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.club_sessions SET pitch_status = 'none'
    WHERE id = p_session_id AND pitch_status = 'requested';

  PERFORM public._notify_coach_request(p_session_id, 'declined');

  RETURN jsonb_build_object('ok', true, 'pitch_status', 'none');
END;
$fn$;
REVOKE ALL     ON FUNCTION public.venue_decline_coach_request(text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_decline_coach_request(text, uuid) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
