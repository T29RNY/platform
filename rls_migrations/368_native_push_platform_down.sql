-- 368_native_push_platform_down.sql — reverse of 368 (renumbered from 362; see up file).
-- Restores the single-web-sub-per-player model and the 2-arg RPC (mig 122).

DROP FUNCTION IF EXISTS public.register_push_subscription(text, jsonb, text);

-- Native rows cannot coexist under UNIQUE(player_id); remove them before the
-- narrower key is restored. Web subs are untouched.
DELETE FROM push_subscriptions WHERE platform <> 'web';

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_player_platform_key;
ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_platform_check;
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_player_id_key UNIQUE (player_id);
ALTER TABLE push_subscriptions
  DROP COLUMN IF EXISTS platform;

-- Original 2-arg body (mig 122).
CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_token        text,
  p_subscription jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_sub_id    uuid;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_subscription IS NULL OR NOT (p_subscription ? 'endpoint') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  INSERT INTO push_subscriptions (player_id, team_id, subscription)
  VALUES (v_player_id, v_team_id, p_subscription)
  ON CONFLICT (player_id)
    DO UPDATE SET subscription = EXCLUDED.subscription,
                  team_id      = EXCLUDED.team_id
  RETURNING id INTO v_sub_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'push_subscription_registered', 'player', v_player_id,
    jsonb_build_object('subscription_id', v_sub_id)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_sub_id);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION register_push_subscription(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION register_push_subscription(text, jsonb) TO anon, authenticated;
