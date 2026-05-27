-- 120_fix_register_push_subscription.sql
-- The register_push_subscription RPC has been broken since the
-- push_subscriptions table was migrated. Three drifts caught it:
--   1. INSERT supplied 'sub_' || ... for `id`, which is a uuid column.
--      The literal could never satisfy the column type.
--   2. INSERT referenced `player_token`, a column that does not exist.
--   3. ON CONFLICT (player_id) referenced a unique key that did not exist.
--
-- Combined with the WHEN OTHERS THEN 'internal_error' catch-all, every
-- failure was masked. Every Enable tap silently no-op'd. push_subscriptions
-- has zero rows globally.
--
-- This migration:
--   - Adds UNIQUE(player_id) so the upsert path works.
--   - Rewrites the RPC body to match the actual table shape (lets the
--     id default fire; drops player_token).
--   - Preserves the audit row and the public error contract.

ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_player_id_key UNIQUE (player_id);

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
