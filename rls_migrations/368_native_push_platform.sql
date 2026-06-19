-- 368_native_push_platform.sql
-- Stage 3.5 of the app-store epic — native push bridge.
--
-- ⚠️ Numbering note: applied to the live DB while the checklist still said
-- "next free = 362", but 362–367 had already merged to main (class_session_
-- roster_age + the s152 demo seed). Renumbered to 368 (next truly-free) here.
-- The live supabase_migrations ledger records this under the name
-- "362_native_push_platform" at timestamp 20260619144316 (latest); the ledger
-- is keyed by timestamp so the apply is correct — only this source label was
-- corrected (Cloud Session Discipline rule 5: leave the live DB, fix the source).
--
-- push_subscriptions previously stored exactly ONE web-push (VAPID) sub per
-- player. Native APNs (iOS) / FCM (Android) device tokens are a DIFFERENT
-- transport, and a single player can hold a web PWA sub AND a native sub at
-- the same time. So this migration:
--   - adds `platform` ('web' | 'ios' | 'android'); every existing row is web.
--   - widens uniqueness from (player_id) to (player_id, platform) so a web sub
--     and a native sub coexist. One row per platform per player; a player on
--     two iPhones collapses to one ios row — acceptable for v1 and no worse
--     than the prior one-row-per-player model.
--   - register_push_subscription gains p_platform (DEFAULT 'web' so the web
--     call sites are byte-unchanged). For native, p_subscription carries
--     { token: '<device-token>' } instead of the VAPID endpoint object; the
--     send-path (api/notify.js) branches on `platform` to pick the transport.
--
-- Hard Rule #9: audit row preserved (now records platform).
-- Hard Rule #11: live apply + this source land in the same commit.
-- Hard Rule #12: register return-shape gains `platform`; no JS mapper reads
--   the RPC result beyond the error (savePushSubscription ignores the body),
--   so no mapper change is required — but the field is added for parity.

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web';

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_platform_check;
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_platform_check
  CHECK (platform IN ('web', 'ios', 'android'));

-- Widen the uniqueness key: web + native must coexist for the same player.
ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_player_id_key;
ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_player_platform_key;
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_player_platform_key UNIQUE (player_id, platform);

-- Single old overload (text, jsonb) — CREATE OR REPLACE would leave it as a
-- separate overload and trigger "could not choose best candidate" once the
-- 3-arg version has a default. Drop it explicitly first (RPC PARAM rule).
DROP FUNCTION IF EXISTS public.register_push_subscription(text, jsonb);

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_token        text,
  p_subscription jsonb,
  p_platform     text DEFAULT 'web'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_sub_id    uuid;
  v_platform  text := COALESCE(NULLIF(p_platform, ''), 'web');
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_platform NOT IN ('web', 'ios', 'android') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  -- Web subs are VAPID objects (need an endpoint); native subs carry a token.
  IF p_subscription IS NULL
     OR (v_platform =  'web' AND NOT (p_subscription ? 'endpoint'))
     OR (v_platform <> 'web' AND NOT (p_subscription ? 'token')) THEN
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

  INSERT INTO push_subscriptions (player_id, team_id, subscription, platform)
  VALUES (v_player_id, v_team_id, p_subscription, v_platform)
  ON CONFLICT (player_id, platform)
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
    jsonb_build_object('subscription_id', v_sub_id, 'platform', v_platform)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_sub_id, 'platform', v_platform);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION register_push_subscription(text, jsonb, text) FROM public;
GRANT  EXECUTE ON FUNCTION register_push_subscription(text, jsonb, text) TO anon, authenticated;
