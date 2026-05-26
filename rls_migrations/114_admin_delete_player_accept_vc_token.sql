-- 114_admin_delete_player_accept_vc_token.sql
--
-- Bug: admin_delete_player rejects calls from Vice Captains.
--
-- When a VC opens the AdminView via /p/<vc_player_token>, the client
-- (App.jsx, post-767b499) passes the VC's player token as the
-- `adminToken` prop to AdminView. AdminView passes that string into
-- deletePlayer(adminToken, id) → admin_delete_player(p_admin_token).
-- The RPC's first guard does `SELECT id FROM teams WHERE admin_token =
-- p_admin_token`. The team's admin_token is a different string from
-- the VC's player token, so the lookup misses and the RPC raises
-- 'invalid_admin_token'. The orphan-guest banner's removeGuest handler
-- in AdminView/index.jsx catches the error and silently console.errors,
-- so the user sees nothing — the banner just stays on screen.
--
-- First hit: session 49 — Tarny (VC on Footy Tuesdays) tried to
-- "Remove Pav" from the host-dropped-out banner. Postgres logs show
-- 4× invalid_admin_token over 30 min, all POST /rpc/admin_delete_player
-- from the user's iPhone. Same error blocks Ranza-from-Squad-Screen
-- and would block ANY VC from removing ANY squad member.
--
-- Fix pattern lifted from mig 073 (admin_set_vice_captain VC fallback),
-- adapted to accept the VC token directly rather than only auth.uid()-
-- null fallback (because the client DOES pass a token, just the wrong
-- kind):
--
-- 1. Try p_admin_token as a team admin_token (original path).
-- 2. If no match, try it as a player.token that belongs to a VC of
--    some team (is_vice_captain=true in team_players).
-- 3. If no match in either path, raise invalid_admin_token.
-- 4. Actor audit captures which path was taken: 'team_admin' or
--    'vice_captain'.
--
-- All other guards (not_found, has_history excluding cancelled, audit
-- insert, cascade-delete order including cancelled-ledger cleanup
-- from mig 113) are preserved exactly. Signature unchanged. No client
-- code change needed for this RPC — VCs were already passing their
-- token; the RPC just learns to recognise it.

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
  v_team_id     text;
  v_actor_type  text;
  v_actor_ident text;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  -- Path 1: team admin_token
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NOT NULL THEN
    v_actor_type  := 'team_admin';
    v_actor_ident := 'admin_token:' || md5(p_admin_token);
  ELSE
    -- Path 2: VC player token. Caller must be a VC on the team
    -- containing the target player.
    SELECT tp_caller.team_id INTO v_team_id
    FROM   players      p_caller
    JOIN   team_players tp_caller ON tp_caller.player_id = p_caller.id
    JOIN   team_players tp_target ON tp_target.team_id   = tp_caller.team_id
    WHERE  p_caller.token            = p_admin_token
      AND  tp_caller.is_vice_captain = true
      AND  tp_target.player_id       = p_player_id
    LIMIT 1;

    IF v_team_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
    END IF;

    v_actor_type  := 'vice_captain';
    v_actor_ident := 'vc_token:' || md5(p_admin_token);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  -- has_history guard (mig 113: cancelled ledger rows do not count).
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
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
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
