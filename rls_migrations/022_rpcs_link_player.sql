CREATE OR REPLACE FUNCTION link_player_to_user(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id text;
  v_user_id   uuid;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;

  -- Check token is valid
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  -- Check this user_id isn't already linked to a different player
  IF EXISTS (
    SELECT 1 FROM players
    WHERE user_id = v_user_id
      AND id != v_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='user_already_linked';
  END IF;

  -- Link player to user
  UPDATE players SET user_id = v_user_id WHERE id = v_player_id;

  RETURN jsonb_build_object('ok', true, 'player_id', v_player_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION link_player_to_user(text) FROM public;
GRANT  EXECUTE ON FUNCTION link_player_to_user(text) TO authenticated;
-- Note: anon NOT granted — this RPC requires an authenticated session (auth.uid())
