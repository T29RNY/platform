-- 593: retire the Gaffer's duplicate chase — delegate to admin_chase_payment (PR #5).
--
-- mig 472's casual.chase_payment branch is the SECOND implementation of "chase the players
-- who owe". It is dark (gated on ai_agent_access.act_enabled, default false, never enabled —
-- GAFFER.md records zero ai_briefings rows), which is the only reason its bugs have never hurt
-- anyone. All four are now proven, three of them the hard way this same session:
--
--   1. CROSS-TEAM AUDIENCE. `COALESCE(pl.owes,0) > 0`. players.owes is deliberately a
--      per-PLAYER total across ALL teams (mig 460:33-38) — so team A's admin would chase a
--      two-squad player about team B's money, with copy naming team A's fixture. EV proved
--      the fix: host owed 20, not 40.
--   2. NO WAIVER SUBTRACTION — well, actually it can't have this bug, because owes IS zeroed
--      by admin_waive_debt. Worth stating plainly since it's the one thing 472 got RIGHT and
--      mig 591 got wrong: reading owes accidentally respects waivers. mig 592 fixed 591 to
--      subtract waivers explicitly, which is now the only definition that is right for BOTH
--      reasons rather than by luck.
--   3. PENDING CLAIMS NOT EXCLUDED. A player who paid cash and is waiting on the admin still
--      has owes > 0 (mig 211: set_player_paid flags self_paid, never clears owes) — so 472
--      duns people who have already paid.
--   4. DEAD HOST. Posts to www.in-or-out.com. mig 361:1-8 repointed every DB-originated POST
--      off www precisely because these calls do NOT follow a redirect and the apex 307 drops
--      the body. 472 was written AFTER 361 and regressed, carrying a rationalising comment
--      inherited from the pre-migration migs 230/049. Dark, so never exercised.
--
-- Plus a wrong rate-limit key: (team_id, type, game_date) over 120 minutes is an
-- availability-chase cadence. Debt persists across weeks; game_date just makes the key
-- silently mutate, and 2h bounds nothing that matters.
--
-- FIX: don't patch four bugs — delete the duplicate. The branch now DELEGATES to
-- admin_chase_payment (mig 591 + 592), which owns the audience, the waiver subtraction, the
-- pending-claim exclusion, the guest roll-up, the minor exclusion, the per-recipient 24h
-- cooldown, the synchronous notification_log bookkeeping, and the send — to the right host.
-- One definition, one send path, one place to fix the next thing.
--
-- What the branch still owns (correctly — it's Gaffer bookkeeping, not chase logic):
-- validating the gaffer_action row, marking it confirmed, and its own
-- gaffer_chase_payment_confirmed audit row so the Gaffer's trail stays intact alongside
-- admin_chase_payment's own admin_chase_payment_sent row. Two audit rows for one action is
-- correct here: they answer different questions ("the Gaffer proposed and the admin
-- confirmed" vs "a chase was attempted, here's who and how many").
--
-- ALSO FIXED: the notify_reserves branch's identical dead www host (:348). Not delegated —
-- it's a different audience (status='reserve') with no admin_* equivalent, so only the host
-- is corrected.
--
-- STILL DARK after this. This does not enable the Gaffer; it makes the branch correct for
-- the day someone does.

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
  v_chase        jsonb;
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
    -- DELEGATED (mig 593). Everything that used to live here — the audience, the rate limit,
    -- the notification_log bookkeeping and the send — is admin_chase_payment's job now. It is
    -- THE definition of "who owes on this team" (mig 591 + 592: team-scoped from the ledger,
    -- waivers subtracted, pending claims and known minors excluded, guests rolled to the host,
    -- per-recipient 24h cooldown, posts to app.in-or-out.com).
    --
    -- It raises the same error strings this branch used to (no_one_owes, chase_rate_limited),
    -- so the Gaffer UI's handling is unchanged. Deliberately NOT caught: an empty audience or
    -- a cooldown hit must abort the whole confirm and leave gaffer_actions 'pending', exactly
    -- as before — the action didn't happen, so it must not be marked as though it did.
    v_chase := admin_chase_payment(p_admin_token, false);

    SELECT COALESCE(array_agg(t->>'player_id'), '{}')
      INTO v_player_ids
      FROM jsonb_array_elements(v_chase->'targets') t;

    UPDATE gaffer_actions SET
      status = 'confirmed',
      confirmed_args = jsonb_build_object('player_ids', to_jsonb(v_player_ids)),
      resolved_at = now()
    WHERE id = p_gaffer_action_id;

    -- The Gaffer's own trail, alongside admin_chase_payment's admin_chase_payment_sent row.
    -- Two rows for one action is correct: they answer different questions — "the Gaffer
    -- proposed this and the admin confirmed it" vs "a chase was attempted, here's the shape".
    INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                              action, entity_type, entity_id, metadata)
    VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
            'gaffer_chase_payment_confirmed', 'gaffer_action', p_gaffer_action_id::text,
            jsonb_build_object('gaffer_action_id', p_gaffer_action_id,
                               'player_ids', to_jsonb(v_player_ids),
                               'game_date', v_game_date,
                               'delegated_to', 'admin_chase_payment',
                               'attempted_count', v_chase->'attempted_count'));

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

    -- app., NOT www. — mig 361:1-8 repointed every DB-originated POST off www because these
    -- calls do NOT follow a redirect and the apex 307 drops the body. 472 regressed to www
    -- after 361 landed; dark, so it was never exercised.
    PERFORM net.http_post(
      url     := 'https://app.in-or-out.com/api/notify',
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
