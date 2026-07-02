-- 472: Gaffer "do it" — chase-payment-now, notify-reserves-now (PR-D of
-- GAFFER_ACTION_FLOW_HANDOFF.md)
--
-- Adds two more branches to the existing gaffer_propose_action /
-- gaffer_confirm_action dispatcher (migration 470) — no new dispatcher
-- infrastructure, per the roadmap's own "additive registry rows + additive
-- RPCs" framing. Both are genuinely new write RPCs (KEY AUDIT FACTS found
-- neither had a real write path before this epic), modelled on the
-- chase_no_response pattern: rate-limited via notification_log, real push,
-- no ledger write (Locked Decision #3 — comms only, never a money-state
-- mutation).
--
-- ── Audit-step design correction (resolved before writing this SQL) ────────
-- The original handoff scoped "notify reserves now" as a push to the
-- cover_pool table. Checked cover_pool's actual columns: id, team_id, name,
-- played, owes — NO contact mechanism at all (no player token, no push
-- subscription, no phone/email). It's a walk-on scorekeeping table, not a
-- notifiable audience — pushing to it is not buildable as literally scoped.
-- Operator sign-off obtained to retarget "notify reserves now" at the
-- squad's own status='reserve' players instead — real app users with real
-- push subscriptions, and the exact same audience migration 230's existing
-- notify_spot_opened trigger already reaches (spot-opened auto-alert to the
-- next reserve). This RPC is the admin-initiated broad version: "heads up,
-- squad's short, stay ready" to every reserve, not just the next-in-line.
--
-- ── Dispatch mechanism differs from chase_no_response ───────────────────────
-- chase_no_response (migration 470) leaves the actual push send to the
-- client (a fetch to /api/notify after confirm succeeds), because that
-- mirrors chaseNoResponders()'s pre-existing client-side call exactly.
-- These two actions have no pre-existing client call to mirror, so they use
-- the more direct pattern migration 230 already established: PERFORM
-- net.http_post(...) straight from gaffer_confirm_action, DIRECT mode
-- (no auth — notify.js's own trigger-config/quiet-hours/injured-filter
-- gating still applies), same canonical www URL migration 230's own comment
-- flags as load-bearing (apex 307-redirects and drops the POST body).
-- gaffer_confirm_action's return carries 'server_sent': true so the client
-- (Gaffer/index.jsx) knows not to fire a second POST for these two keys.

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

  -- Hardcoded allow-list — never a dynamic action_key from the client/LLM
  -- (Locked Decision #1).
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

  ELSIF p_action_key = 'casual.chase_payment' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pl.id, 'name', COALESCE(pl.nickname, pl.name))), '[]'::jsonb)
      INTO v_players
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND NOT pl.disabled
        AND COALESCE(pl.owes, 0) > 0;

  ELSIF p_action_key = 'casual.notify_reserves' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pl.id, 'name', COALESCE(pl.nickname, pl.name))), '[]'::jsonb)
      INTO v_players
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND pl.status = 'reserve'
        AND NOT pl.disabled;

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
  v_player_ids   text[];
  v_game_date    date;
  v_day          text;
  v_squad_size   int;
  v_in_count     int;
  v_recent_count int;
  v_notify_type  text;
  v_body         text;
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

  SELECT s.game_date_time::date, s.day_of_week, s.squad_size
    INTO v_game_date, v_day, v_squad_size
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true
    LIMIT 1;
  IF v_game_date IS NULL THEN v_game_date := current_date; END IF;

  IF p_action_key = 'casual.chase_no_response' THEN
    -- Unchanged from migration 470 — client fires /api/notify itself after
    -- this call succeeds (mirrors the pre-existing chaseNoResponders()).
    SELECT COALESCE(array_agg(pl.id), '{}') INTO v_player_ids
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND pl.status = 'none'
        AND NOT pl.disabled
        AND NOT pl.injured
        AND NOT pl.is_guest;

    IF array_length(v_player_ids, 1) IS NULL OR array_length(v_player_ids, 1) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_responders_to_chase';
    END IF;

    SELECT count(*) INTO v_recent_count
      FROM notification_log
      WHERE team_id = v_team_id AND type = 'chaseNoResp' AND game_date = v_game_date
        AND sent_at >= now() - interval '120 minutes';
    IF v_recent_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='chase_rate_limited';
    END IF;

    UPDATE gaffer_actions SET
      status = 'confirmed',
      confirmed_args = jsonb_build_object('player_ids', to_jsonb(v_player_ids)),
      resolved_at = now()
    WHERE id = p_gaffer_action_id;

    INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                              action, entity_type, entity_id, metadata)
    VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
            'gaffer_chase_no_response_confirmed', 'gaffer_action', p_gaffer_action_id::text,
            jsonb_build_object('gaffer_action_id', p_gaffer_action_id, 'player_ids', to_jsonb(v_player_ids), 'game_date', v_game_date));

    v_result := jsonb_build_object(
      'ok', true, 'action_key', p_action_key,
      'player_ids', to_jsonb(v_player_ids), 'game_date', v_game_date,
      'server_sent', false
    );

  ELSIF p_action_key = 'casual.chase_payment' THEN
    SELECT COALESCE(array_agg(pl.id), '{}') INTO v_player_ids
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND NOT pl.disabled
        AND COALESCE(pl.owes, 0) > 0;

    IF array_length(v_player_ids, 1) IS NULL OR array_length(v_player_ids, 1) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_one_owes';
    END IF;

    v_notify_type := 'gafferChasePayment';
    SELECT count(*) INTO v_recent_count
      FROM notification_log
      WHERE team_id = v_team_id AND type = v_notify_type AND game_date = v_game_date
        AND sent_at >= now() - interval '120 minutes';
    IF v_recent_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='chase_rate_limited';
    END IF;

    UPDATE gaffer_actions SET
      status = 'confirmed',
      confirmed_args = jsonb_build_object('player_ids', to_jsonb(v_player_ids)),
      resolved_at = now()
    WHERE id = p_gaffer_action_id;

    INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                              action, entity_type, entity_id, metadata)
    VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
            'gaffer_chase_payment_confirmed', 'gaffer_action', p_gaffer_action_id::text,
            jsonb_build_object('gaffer_action_id', p_gaffer_action_id, 'player_ids', to_jsonb(v_player_ids), 'game_date', v_game_date));

    -- Write the rate-limit bookkeeping ourselves, synchronously, in this
    -- same transaction — net.http_post below is fire-and-forget (pg_net
    -- queues the HTTP call and returns immediately), so notify.js's own
    -- notification_log insert on the far end of that async call is NOT
    -- guaranteed to land before a rapid second confirm's cooldown check
    -- runs. Discovered by ephemeral-verify: without this, two gaffer_actions
    -- rows confirmed in quick succession could both sail past the 120-min
    -- cooldown. chase_no_response doesn't have this gap because its send is
    -- a client-awaited fetch, not a fire-and-forget RPC-internal call.
    INSERT INTO notification_log (team_id, player_id, type, game_date, sent_at)
      SELECT v_team_id, pid, v_notify_type, v_game_date, now()
      FROM unnest(v_player_ids) AS pid;

    -- Comms-only send, never a ledger write (Locked Decision #3) — no
    -- amounts, no payment-state mutation, just a reminder push.
    PERFORM net.http_post(
      url     := 'https://www.in-or-out.com/api/notify',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'type',      v_notify_type,
        'teamId',    v_team_id,
        'playerIds', to_jsonb(v_player_ids),
        'payload',   jsonb_build_object(
          'title', 'In or Out ⚽',
          'body',  '💷 You''ve got outstanding fees for ' || COALESCE(v_day, 'the game') || ' — settle up when you can!',
          'icon',  '/icons/icon-192.png'),
        'gameDate',  to_char(v_game_date, 'YYYY-MM-DD')
      )
    );

    v_result := jsonb_build_object(
      'ok', true, 'action_key', p_action_key,
      'player_ids', to_jsonb(v_player_ids), 'game_date', v_game_date,
      'server_sent', true
    );

  ELSIF p_action_key = 'casual.notify_reserves' THEN
    SELECT COALESCE(array_agg(pl.id), '{}') INTO v_player_ids
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND pl.status = 'reserve'
        AND NOT pl.disabled;

    IF array_length(v_player_ids, 1) IS NULL OR array_length(v_player_ids, 1) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_reserves_to_notify';
    END IF;

    SELECT count(*) INTO v_in_count
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND pl.status = 'in' AND NOT pl.disabled AND NOT pl.injured;
    IF v_squad_size IS NOT NULL AND v_in_count >= v_squad_size THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='squad_already_full';
    END IF;

    v_notify_type := 'gafferNotifyReserves';
    SELECT count(*) INTO v_recent_count
      FROM notification_log
      WHERE team_id = v_team_id AND type = v_notify_type AND game_date = v_game_date
        AND sent_at >= now() - interval '120 minutes';
    IF v_recent_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='chase_rate_limited';
    END IF;

    UPDATE gaffer_actions SET
      status = 'confirmed',
      confirmed_args = jsonb_build_object('player_ids', to_jsonb(v_player_ids)),
      resolved_at = now()
    WHERE id = p_gaffer_action_id;

    INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                              action, entity_type, entity_id, metadata)
    VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
            'gaffer_notify_reserves_confirmed', 'gaffer_action', p_gaffer_action_id::text,
            jsonb_build_object('gaffer_action_id', p_gaffer_action_id, 'player_ids', to_jsonb(v_player_ids), 'game_date', v_game_date));

    -- Synchronous rate-limit bookkeeping — see the chase_payment branch
    -- above for why (fire-and-forget net.http_post race, found by EV).
    INSERT INTO notification_log (team_id, player_id, type, game_date, sent_at)
      SELECT v_team_id, pid, v_notify_type, v_game_date, now()
      FROM unnest(v_player_ids) AS pid;

    PERFORM net.http_post(
      url     := 'https://www.in-or-out.com/api/notify',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'type',      v_notify_type,
        'teamId',    v_team_id,
        'playerIds', to_jsonb(v_player_ids),
        'payload',   jsonb_build_object(
          'title', 'In or Out ⚽',
          'body',  '👀 Squad''s short for ' || COALESCE(v_day, 'the game') || ' — stay ready, a spot might open!',
          'icon',  '/icons/icon-192.png'),
        'gameDate',  to_char(v_game_date, 'YYYY-MM-DD')
      )
    );

    v_result := jsonb_build_object(
      'ok', true, 'action_key', p_action_key,
      'player_ids', to_jsonb(v_player_ids), 'game_date', v_game_date,
      'server_sent', true
    );

  ELSE
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unknown_action_key';
  END IF;

  RETURN v_result;
END;
$function$;
