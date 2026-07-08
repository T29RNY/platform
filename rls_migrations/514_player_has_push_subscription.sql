-- 514_player_has_push_subscription.sql
-- Fix: the casual "TURN ON NOTIFICATIONS?" banner re-nags players who are
-- ALREADY subscribed. The banner is gated purely on a client-side localStorage
-- flag (notif_<playerId>); if that flag is lost (app update / cache clear) or an
-- in-app registration round-trip is interrupted, the client forgets the player
-- is subscribed and shows the banner again — even though a valid push token is
-- saved server-side. Reported for player Rocky (p_cQ-NpVz55ng), whose iOS token
-- has been on file since 2026-07-01.
--
-- This read-only RPC lets the client learn the SERVER truth on mount and suppress
-- the banner when a subscription already exists on any platform. Token-scoped:
-- derives player_id from p_token server-side (never trusts a passed id).
--
-- Read-only: no INSERT/UPDATE, so no audit_events row (Hard Rule #9 covers
-- fire-and-forget WRITES) and nothing for ephemeral-verify to roll back.
-- Mirrors register_push_subscription's security shape (mig 368).

CREATE OR REPLACE FUNCTION public.player_has_push_subscription(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_has       boolean := false;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Unknown token → simply "not subscribed" (a read, be lenient; don't raise).
  SELECT id INTO v_player_id FROM players WHERE token = p_token LIMIT 1;
  IF v_player_id IS NULL THEN
    RETURN jsonb_build_object('subscribed', false);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM push_subscriptions WHERE player_id = v_player_id
  ) INTO v_has;

  RETURN jsonb_build_object('subscribed', v_has);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE ALL   ON FUNCTION public.player_has_push_subscription(text) FROM public;
GRANT EXECUTE ON FUNCTION public.player_has_push_subscription(text) TO anon, authenticated;
