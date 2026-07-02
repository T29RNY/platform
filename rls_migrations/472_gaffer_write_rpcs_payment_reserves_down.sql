-- Down migration for 472_gaffer_write_rpcs_payment_reserves.sql
-- Restores gaffer_propose_action / gaffer_confirm_action to their migration
-- 470 shape (chase_no_response only).

CREATE OR REPLACE FUNCTION public.gaffer_propose_action(
  p_admin_token text,
  p_action_key text,
  p_nudge_key text DEFAULT NULL,
  p_source text DEFAULT 'nudge'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type  text;
  v_actor_ident text;
  v_team_id     text;
  v_act_enabled boolean;
  v_action_id   uuid;
  v_players     jsonb;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;
  IF v_actor_type NOT IN ('team_admin', 'vice_captain') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authorised';
  END IF;

  SELECT act_enabled INTO v_act_enabled
    FROM ai_agent_access
    WHERE scope_type = 'team' AND scope_id = v_team_id;
  IF NOT COALESCE(v_act_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='act_not_enabled';
  END IF;

  IF p_source NOT IN ('nudge', 'chat') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_source';
  END IF;

  IF p_action_key = 'casual.chase_no_response' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pl.id, 'name', COALESCE(pl.nickname, pl.name))), '[]'::jsonb)
      INTO v_players
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND pl.status = 'none'
        AND NOT pl.disabled
        AND NOT pl.injured
        AND NOT pl.is_guest;
  ELSE
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unknown_action_key';
  END IF;

  INSERT INTO gaffer_actions (team_id, nudge_key, source, action_key, proposed_args)
  VALUES (v_team_id, p_nudge_key, p_source, p_action_key, jsonb_build_object('players', v_players))
  RETURNING id INTO v_action_id;

  RETURN jsonb_build_object(
    'gaffer_action_id', v_action_id,
    'action_key', p_action_key,
    'preview', jsonb_build_object('players', v_players)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.gaffer_confirm_action(
  p_admin_token text,
  p_gaffer_action_id uuid,
  p_action_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type   text;
  v_actor_ident  text;
  v_team_id      text;
  v_act_enabled  boolean;
  v_action       gaffer_actions;
  v_no_resp_ids  text[];
  v_game_date    date;
  v_recent_count int;
  v_result       jsonb;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;
  IF v_actor_type NOT IN ('team_admin', 'vice_captain') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authorised';
  END IF;

  SELECT act_enabled INTO v_act_enabled
    FROM ai_agent_access
    WHERE scope_type = 'team' AND scope_id = v_team_id;
  IF NOT COALESCE(v_act_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='act_not_enabled';
  END IF;

  SELECT * INTO v_action FROM gaffer_actions
    WHERE id = p_gaffer_action_id AND team_id = v_team_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='gaffer_action_not_found';
  END IF;
  IF v_action.action_key IS DISTINCT FROM p_action_key THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='action_key_mismatch';
  END IF;
  IF v_action.status <> 'pending' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='gaffer_action_already_resolved';
  END IF;

  IF p_action_key = 'casual.chase_no_response' THEN
    SELECT COALESCE(array_agg(pl.id), '{}') INTO v_no_resp_ids
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND pl.status = 'none'
        AND NOT pl.disabled
        AND NOT pl.injured
        AND NOT pl.is_guest;

    IF array_length(v_no_resp_ids, 1) IS NULL OR array_length(v_no_resp_ids, 1) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_responders_to_chase';
    END IF;

    SELECT s.game_date_time::date INTO v_game_date
      FROM schedule s WHERE s.team_id = v_team_id AND s.active = true
      LIMIT 1;
    IF v_game_date IS NULL THEN v_game_date := current_date; END IF;

    SELECT count(*) INTO v_recent_count
      FROM notification_log
      WHERE team_id = v_team_id AND type = 'chaseNoResp' AND game_date = v_game_date
        AND sent_at >= now() - interval '120 minutes';
    IF v_recent_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='chase_rate_limited';
    END IF;

    UPDATE gaffer_actions SET
      status = 'confirmed',
      confirmed_args = jsonb_build_object('player_ids', to_jsonb(v_no_resp_ids)),
      resolved_at = now()
    WHERE id = p_gaffer_action_id;

    INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                              action, entity_type, entity_id, metadata)
    VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
            'gaffer_chase_no_response_confirmed', 'gaffer_action', p_gaffer_action_id::text,
            jsonb_build_object('gaffer_action_id', p_gaffer_action_id, 'player_ids', to_jsonb(v_no_resp_ids), 'game_date', v_game_date));

    v_result := jsonb_build_object(
      'ok', true,
      'action_key', p_action_key,
      'player_ids', to_jsonb(v_no_resp_ids),
      'game_date', v_game_date
    );
  ELSE
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unknown_action_key';
  END IF;

  RETURN v_result;
END;
$function$;
