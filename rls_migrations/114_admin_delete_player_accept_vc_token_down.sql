-- 114_admin_delete_player_accept_vc_token_down.sql
--
-- Reverts mig 114. Restores the post-mig-113 body (admin_token-only
-- caller, no VC path). After this runs, Vice Captains will once again
-- fail with invalid_admin_token when removing players via the
-- AdminView orphan banner or Squad screen.

CREATE OR REPLACE FUNCTION admin_delete_player(
  p_admin_token text,
  p_player_id   text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id text;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  IF (
    COALESCE((SELECT attended FROM players WHERE id = p_player_id), 0) > 0
    OR EXISTS (SELECT 1 FROM player_match WHERE player_id = p_player_id)
    OR EXISTS (
      SELECT 1 FROM payment_ledger
      WHERE player_id = p_player_id
        AND status <> 'cancelled'
    )
    OR EXISTS (
      SELECT 1 FROM potm_votes
      WHERE voter_id = p_player_id OR nominee_id = p_player_id
    )
    OR EXISTS (SELECT 1 FROM player_injuries WHERE player_id = p_player_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'has_history';
  END IF;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_deleted', 'player', p_player_id,
    jsonb_build_object('player_id', p_player_id)
  );

  DELETE FROM team_players
  WHERE  player_id = p_player_id
    AND  team_id   = v_team_id;

  DELETE FROM player_injuries
  WHERE  player_id = p_player_id
    AND  team_id   = v_team_id;

  DELETE FROM push_subscriptions
  WHERE  player_id = p_player_id;

  DELETE FROM player_career WHERE player_id = p_player_id;

  DELETE FROM payment_ledger
  WHERE  player_id = p_player_id
    AND  status    = 'cancelled';

  DELETE FROM players WHERE id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_deleted');

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_delete_player(text, text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_delete_player(text, text) TO anon, authenticated;
