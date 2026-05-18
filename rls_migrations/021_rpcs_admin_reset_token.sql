CREATE OR REPLACE FUNCTION admin_reset_player_token(
  p_admin_token text,
  p_player_id   text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_team_id   text;
  v_new_token text;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM team_players
    WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_found';
  END IF;
  v_new_token := generate_url_safe_token('p_', 12);
  UPDATE players SET token = v_new_token WHERE id = p_player_id;
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_token_reset', 'player', p_player_id,
    jsonb_build_object('player_id', p_player_id)
  );
  PERFORM notify_team_change(v_team_id, 'player_updated');
  RETURN jsonb_build_object('ok', true, 'token', v_new_token, 'player_id', p_player_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$func$;
REVOKE EXECUTE ON FUNCTION admin_reset_player_token(text, text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_reset_player_token(text, text) TO anon, authenticated;
