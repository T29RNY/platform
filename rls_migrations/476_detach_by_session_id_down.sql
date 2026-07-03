-- 476 DOWN: revert delete_match_health_session to the mig-475 (p_client_session_id text) signature.

DROP FUNCTION IF EXISTS delete_match_health_session(uuid);

CREATE OR REPLACE FUNCTION delete_match_health_session(p_client_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id       uuid := auth.uid();
  v_id            uuid;
  v_match_context text;
  v_match_ref     text;
  v_team_id       text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_client_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT id, match_context, match_ref
    INTO v_id, v_match_context, v_match_ref
    FROM match_health_sessions
   WHERE user_id = v_user_id AND client_session_id = p_client_session_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_found';
  END IF;

  DELETE FROM match_health_sessions WHERE id = v_id AND user_id = v_user_id;

  IF v_match_context = 'casual' THEN
    SELECT team_id INTO v_team_id FROM matches WHERE id = v_match_ref;
  ELSE
    BEGIN
      SELECT home_team_id INTO v_team_id FROM fixtures WHERE id = v_match_ref::uuid;
    EXCEPTION WHEN others THEN v_team_id := NULL;
    END;
  END IF;
  v_team_id := COALESCE(v_team_id, 'health');

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', v_user_id, 'auth_uid:' || v_user_id::text,
    'match_health_deleted', 'match_health_session', v_id::text,
    jsonb_build_object(
      'match_context', v_match_context,
      'match_ref', v_match_ref,
      'client_session_id', p_client_session_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'deleted', true, 'id', v_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION delete_match_health_session(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION delete_match_health_session(text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
