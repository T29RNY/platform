-- 476: Match Fitness Stats PR #9d — detach RPC keys on the session id (uuid), not client_session_id
--
-- mig 475 shipped delete_match_health_session(p_client_session_id text). The detach UI lives on the
-- result card, which renders get_match_health_for_match rows — those carry `session_id` (the DB uuid),
-- NOT `client_session_id` (the HKWorkout.uuid, never returned by the reader). So the delete key is
-- re-pointed to the DB session id: the natural, stable handle the UI already holds. Own-row-only is
-- preserved (the user_id = auth.uid() filter is unchanged); the route row still cascades; audit still
-- fires (Hard Rule #9). The delete RPC has NO consumers yet (PR #9d is its first), so this signature
-- change is free of call-site breakage.
--
-- Param-type change ⇒ DROP the old (text) overload explicitly before CREATE (else PostgreSQL keeps
-- both and "could not choose best candidate function"). Tier-3: drafted, ephemeral-verified with
-- rollback, applied only after operator sign-off.

DROP FUNCTION IF EXISTS delete_match_health_session(text);

CREATE OR REPLACE FUNCTION delete_match_health_session(p_session_id uuid)
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
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  -- Own-row-only: scoping on user_id means another user's session is never visible/deletable here.
  SELECT id, match_context, match_ref
    INTO v_id, v_match_context, v_match_ref
    FROM match_health_sessions
   WHERE id = p_session_id AND user_id = v_user_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_found';
  END IF;

  -- Route row cascades via match_health_routes.session_id ON DELETE CASCADE (mig 456).
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
      'session_id', v_id::text
    )
  );

  RETURN jsonb_build_object('ok', true, 'deleted', true, 'id', v_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION delete_match_health_session(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION delete_match_health_session(uuid) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
