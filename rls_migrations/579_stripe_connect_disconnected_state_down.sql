-- 579_stripe_connect_disconnected_state_down.sql
-- Restore set_venue_connect_state to its mig-329 body: status guard rejects
-- 'disconnected' again, no disconnected_at INSERT branch, no audit trail on disconnect.

CREATE OR REPLACE FUNCTION public.set_venue_connect_state(
  p_venue_id         text,
  p_account_id       text,
  p_status           text,
  p_charges_enabled  boolean,
  p_details_submitted boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_vi_status text;
BEGIN
  IF p_status NOT IN ('none','onboarding','active','restricted') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE='P0001';
  END IF;

  -- Map the Stripe account status onto the integration row's status:
  -- 'none' → 'pending'  (no account yet or disconnected)
  -- 'onboarding' → 'pending' (Connect onboarding in progress)
  -- 'active' → 'connected'
  -- 'restricted' → 'connected' (active but with restrictions; still usable)
  v_vi_status := CASE p_status
    WHEN 'active'      THEN 'connected'
    WHEN 'restricted'  THEN 'connected'
    WHEN 'onboarding'  THEN 'pending'
    ELSE                    'pending'
  END;

  INSERT INTO public.venue_integrations
    (venue_id, provider, status, account_id, config, connected_at, updated_at)
  VALUES (
    p_venue_id,
    'stripe',
    v_vi_status,
    p_account_id,
    jsonb_build_object(
      'stripe_status',       p_status,
      'charges_enabled',     p_charges_enabled,
      'details_submitted',   p_details_submitted
    ),
    CASE WHEN v_vi_status = 'connected' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (venue_id, provider) DO UPDATE
    SET status             = EXCLUDED.status,
        account_id         = COALESCE(EXCLUDED.account_id, venue_integrations.account_id),
        config             = venue_integrations.config || EXCLUDED.config,
        connected_at       = CASE
                               WHEN EXCLUDED.status = 'connected'
                                    AND venue_integrations.connected_at IS NULL
                               THEN now()
                               ELSE venue_integrations.connected_at
                             END,
        disconnected_at    = CASE
                               WHEN EXCLUDED.status = 'disconnected' THEN now()
                               ELSE venue_integrations.disconnected_at
                             END,
        updated_at         = now();

  RETURN jsonb_build_object('ok', true, 'venue_id', p_venue_id, 'status', v_vi_status);
END; $fn$;

REVOKE ALL ON FUNCTION public.set_venue_connect_state(text,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_venue_connect_state(text,text,text,boolean,boolean) TO service_role;
