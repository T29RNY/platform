-- 330_stripe_connect_phase2.sql
--
-- Phase 2: Stripe Connect venue OAuth flow.
-- Adds venue_stripe_disconnect — the only client-callable write RPC for Phase 2.
-- The connect/refresh flow lives in api/stripe-connect.js (service_role, calls Stripe).

CREATE OR REPLACE FUNCTION public.venue_stripe_disconnect(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_current  record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  SELECT status INTO v_current
    FROM public.venue_integrations
   WHERE venue_id = v_venue_id AND provider = 'stripe';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_connected' USING ERRCODE='P0001';
  END IF;

  -- Idempotent: already disconnected is a no-op
  IF v_current.status = 'disconnected' THEN
    RETURN jsonb_build_object('ok', true, 'already_disconnected', true);
  END IF;

  UPDATE public.venue_integrations
     SET status          = 'disconnected',
         disconnected_at = now(),
         updated_at      = now()
   WHERE venue_id = v_venue_id AND provider = 'stripe';

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', NULL, 'venue_admin', 'stripe_disconnected', 'venue', v_venue_id,
          jsonb_build_object('venue_id', v_venue_id));

  RETURN jsonb_build_object('ok', true);
END; $fn$;

REVOKE ALL ON FUNCTION public.venue_stripe_disconnect(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_stripe_disconnect(text) TO anon, authenticated;
