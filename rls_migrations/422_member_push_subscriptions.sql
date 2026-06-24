-- 422_member_push_subscriptions.sql
-- Calendar & Mobile Phase 4 — push for comms + pitch-bumps.
--
-- The push transport (mig 368) keys subscriptions on player_id (casual players).
-- Club managers/members are auth.uid()→member_profiles and have NO player row,
-- so they could never register a device AND the send-path (api/notify.js) could
-- never find them. Today comms + bumps reach members by EMAIL only.
--
-- This migration widens push_subscriptions to ALSO hold member subscriptions
-- keyed on auth_user_id, and adds authenticated register/unregister RPCs for
-- them. Same table, same deliverPush dispatcher — only the owner column differs
-- (player_id for casual, auth_user_id for members; exactly one per row).
--
-- A pitch-bump proposal already creates a club_announcement (mig 417 _notify_bump),
-- so wiring announcement delivery to push (cron.js clubBroadcastJob) covers BOTH
-- comms and bumps with one change.
--
-- Hard Rule #9: register audits into audit_events (sentinel team_id '_system',
--   mirroring mig 392 club_manager_send_announcement which also has no casual team).
-- Hard Rule #11: live apply + this source land in the same commit.

-- ── 1. push_subscriptions: add the member (auth.uid) owner ────────────────────

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Exactly one owner per row: a casual player OR an authenticated member.
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_owner_chk;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_owner_chk
  CHECK (num_nonnulls(player_id, auth_user_id) = 1);

-- One row per (member, platform) — mirrors the (player_id, platform) key so a
-- member can hold a web sub and a native sub at once, one per platform.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_authuser_platform_key
  ON public.push_subscriptions (auth_user_id, platform)
  WHERE auth_user_id IS NOT NULL;

-- ── 2. register_member_push_subscription (authenticated) ──────────────────────

CREATE OR REPLACE FUNCTION public.register_member_push_subscription(
  p_subscription jsonb,
  p_platform     text DEFAULT 'web'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_platform text := COALESCE(NULLIF(p_platform, ''), 'web');
  v_sub_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_authenticated';
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

  INSERT INTO push_subscriptions (auth_user_id, subscription, platform)
  VALUES (v_uid, p_subscription, v_platform)
  ON CONFLICT (auth_user_id, platform) WHERE auth_user_id IS NOT NULL
    DO UPDATE SET subscription = EXCLUDED.subscription
  RETURNING id INTO v_sub_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'player', v_uid, 'auth_user:' || v_uid::text,
    'member_push_subscription_registered', 'auth_user', v_uid::text,
    jsonb_build_object('subscription_id', v_sub_id, 'platform', v_platform)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_sub_id, 'platform', v_platform);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE ALL     ON FUNCTION public.register_member_push_subscription(jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.register_member_push_subscription(jsonb, text) TO authenticated;

-- ── 3. unregister_member_push_subscription (authenticated) ────────────────────
-- p_platform NULL = remove every platform for this member (e.g. "turn off").

CREATE OR REPLACE FUNCTION public.unregister_member_push_subscription(
  p_platform text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_authenticated';
  END IF;

  DELETE FROM push_subscriptions
   WHERE auth_user_id = v_uid
     AND (p_platform IS NULL OR platform = p_platform);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'deleted', v_n);
END;
$$;

REVOKE ALL     ON FUNCTION public.unregister_member_push_subscription(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unregister_member_push_subscription(text) TO authenticated;
