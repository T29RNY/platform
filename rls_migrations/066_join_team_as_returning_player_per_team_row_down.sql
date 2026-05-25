-- 066 DOWN — restore migration 015's join_team_as_returning_player.

CREATE OR REPLACE FUNCTION join_team_as_returning_player(
  p_join_code text,
  p_user_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id   text;
  v_player_id text;
  v_token     text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE join_code = p_join_code OR id = p_join_code LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='team_not_found';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='forbidden';
  END IF;

  SELECT id, token INTO v_player_id, v_token
  FROM players WHERE user_id = p_user_id LIMIT 1;

  IF v_player_id IS NULL THEN
    RETURN jsonb_build_object(
      'player_id',    null,
      'team_id',      v_team_id,
      'token',        null,
      'is_new_team',  false
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = v_player_id
  ) THEN
    RETURN jsonb_build_object(
      'player_id',   v_player_id,
      'team_id',     v_team_id,
      'token',       v_token,
      'is_new_team', false
    );
  END IF;

  INSERT INTO team_players (team_id, player_id)
  VALUES (v_team_id, v_player_id)
  ON CONFLICT (team_id, player_id) DO NOTHING;

  RETURN jsonb_build_object(
    'player_id',   v_player_id,
    'team_id',     v_team_id,
    'token',       v_token,
    'is_new_team', true
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION join_team_as_returning_player(text,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION join_team_as_returning_player(text,uuid) TO authenticated, anon;

SELECT pg_notify('pgrst', 'reload schema');
