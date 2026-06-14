-- Migration 304 — Phase 10 Club Attendance: Slice 4E
-- New RPC: club_manager_mark_attendance
-- Auth: auth.uid() → member_profiles → club_team_managers (is_active=true, team_id = session.team_id)
-- No venue token. Authenticated only (anon explicitly revoked).
-- Audit: team_id='_system', actor_type='player', action='club_attendance_marked'

CREATE OR REPLACE FUNCTION public.club_manager_mark_attendance(
  p_session_id  uuid,
  p_attendances jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile record;
  v_session record;
  v_row     jsonb;
  v_count   integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_session FROM public.club_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_session.team_id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = v_session.team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_manager' USING ERRCODE = 'P0001'; END IF;

  IF v_session.status <> 'scheduled' THEN
    RAISE EXCEPTION 'session_not_scheduled' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_attendances) LOOP
    IF (v_row->>'status') NOT IN ('attended','absent','late') THEN
      RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.club_session_attendance
      (session_id, member_profile_id, status, marked_by_user_id)
    VALUES (
      p_session_id,
      (v_row->>'member_profile_id')::uuid,
      v_row->>'status',
      v_uid
    )
    ON CONFLICT (session_id, member_profile_id)
      DO UPDATE SET
        status            = EXCLUDED.status,
        marked_by_user_id = EXCLUDED.marked_by_user_id,
        marked_at         = now();
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'club_attendance_marked', 'club_session', p_session_id::text,
    jsonb_build_object('session_id', p_session_id, 'team_id', v_session.team_id,
                       'club_id', v_session.club_id, 'count', v_count)
  );

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'marked', v_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_mark_attendance(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_mark_attendance(uuid, jsonb) TO authenticated;
