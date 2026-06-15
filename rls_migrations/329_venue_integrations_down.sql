-- 329_venue_integrations_down.sql

DROP FUNCTION IF EXISTS public.venue_get_billing_status(text);
DROP FUNCTION IF EXISTS public.set_venue_connect_state(text,text,text,boolean,boolean);
DROP TABLE IF EXISTS public.venue_integrations;

-- Restore the four venues stripe columns removed in the up migration.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id  text,
  ADD COLUMN IF NOT EXISTS stripe_connect_status      text NOT NULL DEFAULT 'none'
    CHECK (stripe_connect_status IN ('none','onboarding','active','restricted')),
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted   boolean NOT NULL DEFAULT false;

-- Restore original RPCs from mig 279 (recreated from their source).
CREATE OR REPLACE FUNCTION public.set_venue_connect_state(
  p_venue_id text, p_account_id text, p_status text,
  p_charges_enabled boolean, p_details_submitted boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF p_status NOT IN ('none','onboarding','active','restricted') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE='P0001';
  END IF;
  UPDATE public.venues
     SET stripe_connect_account_id = COALESCE(p_account_id, stripe_connect_account_id),
         stripe_connect_status     = p_status,
         stripe_charges_enabled    = COALESCE(p_charges_enabled, stripe_charges_enabled),
         stripe_details_submitted  = COALESCE(p_details_submitted, stripe_details_submitted)
   WHERE id = p_venue_id;
  RETURN jsonb_build_object('ok', FOUND, 'venue_id', p_venue_id, 'status', p_status);
END; $fn$;
REVOKE ALL ON FUNCTION public.set_venue_connect_state(text,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_venue_connect_state(text,text,text,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.venue_get_billing_status(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_v record; v_members jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  SELECT stripe_connect_account_id, stripe_connect_status, stripe_charges_enabled, stripe_details_submitted
    INTO v_v FROM public.venues WHERE id = v_venue_id;
  SELECT jsonb_build_object(
    'total',     count(*),
    'on_stripe', count(*) FILTER (WHERE stripe_subscription_id IS NOT NULL),
    'current',   count(*) FILTER (WHERE payment_state='current'),
    'past_due',  count(*) FILTER (WHERE payment_state='past_due'),
    'suspended', count(*) FILTER (WHERE payment_state='suspended')
  ) INTO v_members FROM public.venue_memberships WHERE venue_id = v_venue_id AND status <> 'cancelled';
  RETURN jsonb_build_object('ok', true,
    'connect', jsonb_build_object(
      'account_id',        v_v.stripe_connect_account_id,
      'status',            v_v.stripe_connect_status,
      'charges_enabled',   v_v.stripe_charges_enabled,
      'details_submitted', v_v.stripe_details_submitted),
    'members', COALESCE(v_members, '{}'::jsonb));
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_get_billing_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_get_billing_status(text) TO anon, authenticated;
