-- 563_coach_withdraw_pitch_request.sql
-- Coach self-service pitch booking — Phase 4b: withdraw a pending pitch REQUEST.
--
-- Decision A (operator, 2026-07-12): "cancel my pending request" = withdraw just the
-- PITCH, not the whole session. A coach-booked clash lands as a club_session
-- status='scheduled', pitch_status='requested' (mig 560); this RPC lets the coach take
-- it back — sets pitch_status='none' so the session stays alive (visible, RSVPs kept)
-- as "pitch TBC" and the coach can re-pick a slot. Cancelling the whole session stays
-- the separate existing action (club_manager_cancel_session). This is the decoupled
-- model (5b): the session persists, only the pitch state changes.
--
-- Guards:
--   * auth.uid() → member_profiles → active club_team_manager of the session's team
--     (identical gate to club_manager_book_pitch, mig 560).
--   * only a pitch_status='requested' session is withdrawable (else not_a_pending_request).
--   * a session with a PENDING pitch_bump_proposal must be resolved via the bump card
--     (accept/decline → _apply_bump_resolution), NOT withdrawn — otherwise the proposal
--     is orphaned. Route the coach there with pending_bump_resolve_via_proposal.
--
-- Occupancy: a 'requested' session holds NO occupancy (it never reserved — mig 558
-- trigger reserves only on pitch_status='allocated'), and pitch_status is not in the
-- occupancy trigger's `UPDATE OF status,venue_id,playing_area_id,scheduled_at` list, so
-- this UPDATE neither fires the trigger nor leaves a dangling reservation. Setting
-- 'none' is a pure state/label change.
--
-- Audit (Hard Rule #9): every coach self-write leaves a server-side audit_events row.
-- GRANT authenticated only; REVOKE anon (auth.uid()-gated; anon → not_authenticated).
--
-- Proof: ephemeral-verify (throwaway _e2e_ fixture, auto-rollback, leak 0) MUST show:
--   (1) requested → withdraw → pitch_status='none', session STILL status='scheduled',
--       holds no occupancy, audit row written;
--   (2) an 'allocated' session → not_a_pending_request (untouched);
--   (3) a 'requested' session WITH a pending bump proposal → pending_bump_resolve_via_proposal
--       (untouched — proposal not orphaned);
--   (4) a non-manager caller → not_a_manager (untouched);
--   (5) an unauthenticated caller → not_authenticated.

CREATE OR REPLACE FUNCTION public.club_manager_withdraw_pitch_request(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile record;
  v_session record;
BEGIN
  -- ── Auth: auth.uid() → member_profiles → active manager of the session's team ──
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT id, team_id, club_id, venue_id, playing_area_id, pitch_status
    INTO v_session
    FROM public.club_sessions WHERE id = p_session_id;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_session.team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = v_session.team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  -- ── Only a pending PITCH REQUEST is withdrawable ──
  IF v_session.pitch_status <> 'requested' THEN
    RAISE EXCEPTION 'not_a_pending_request' USING ERRCODE = 'P0001';
  END IF;

  -- ── A session with a PENDING bump proposal must be resolved via the bump card
  --    (accept/decline), never raw-withdrawn — else the proposal is orphaned. ──
  IF EXISTS (
    SELECT 1 FROM public.pitch_bump_proposals
    WHERE event_kind = 'club_session' AND event_id = p_session_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'pending_bump_resolve_via_proposal' USING ERRCODE = 'P0001';
  END IF;

  -- ── Drop the pitch: session stays scheduled + visible, RSVPs kept, pitch TBC.
  --    The `AND pitch_status='requested'` makes the write concurrency-safe (TOCTOU):
  --    if a future path (PR #5 approve) flipped this row 'requested'→'allocated'
  --    between the SELECT above and here, the write is a no-op rather than blindly
  --    clearing an allocated pitch and stranding its reservation. ──
  UPDATE public.club_sessions SET pitch_status = 'none'
    WHERE id = p_session_id AND pitch_status = 'requested';

  -- ── Audit (Hard Rule #9) ──
  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'coach_pitch_request_withdrawn', 'club_sessions', p_session_id::text,
    jsonb_build_object('team_id', v_session.team_id, 'club_id', v_session.club_id,
                       'venue_id', v_session.venue_id, 'playing_area_id', v_session.playing_area_id)
  );

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'pitch_status', 'none');
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_withdraw_pitch_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_withdraw_pitch_request(uuid) TO authenticated;

-- PostgREST schema cache refresh (new function signature)
SELECT pg_notify('pgrst', 'reload schema');
