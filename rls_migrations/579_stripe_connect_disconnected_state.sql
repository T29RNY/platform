-- 579_stripe_connect_disconnected_state.sql
--
-- Stripe webhook robustness (Connect deauthorization). Makes 'disconnected' a REAL
-- settable state on venue_integrations via set_venue_connect_state, so the new
-- account.application.deauthorized webhook (apps/inorout/api/stripe-webhook.js)
-- records a venue revoking our Connect access as a first-class disconnection —
-- status='disconnected' + disconnected_at stamped + an append-only audit trail —
-- rather than conflating it with 'pending' (onboarding-not-finished).
--
-- The venue_integrations CHECK already allows 'disconnected' and the disconnected_at
-- column + the ON CONFLICT branch were built for it (mig 329); this closes the gap
-- where set_venue_connect_state could never actually PRODUCE that state (its status
-- guard rejected 'disconnected', so the disconnected_at branch was dead code).
--
-- No signature change (text,text,text,boolean,boolean) → CREATE OR REPLACE, no DROP,
-- grants preserved (re-asserted at the foot for explicitness). service_role-only
-- (webhook/onboarding callback). Down restores the mig-329 body verbatim.

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
  IF p_status NOT IN ('none','onboarding','active','restricted','disconnected') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE='P0001';
  END IF;

  -- Map the Stripe account status onto the integration row's status:
  -- 'none' → 'pending'  (no account yet)
  -- 'onboarding' → 'pending' (Connect onboarding in progress)
  -- 'active' → 'connected'
  -- 'restricted' → 'connected' (active but with restrictions; still usable)
  -- 'disconnected' → 'disconnected' (Connect access revoked — account.application.deauthorized)
  v_vi_status := CASE p_status
    WHEN 'active'        THEN 'connected'
    WHEN 'restricted'    THEN 'connected'
    WHEN 'onboarding'    THEN 'pending'
    WHEN 'disconnected'  THEN 'disconnected'
    ELSE                      'pending'
  END;

  INSERT INTO public.venue_integrations
    (venue_id, provider, status, account_id, config, connected_at, disconnected_at, updated_at)
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
    CASE WHEN v_vi_status = 'connected'    THEN now() ELSE NULL END,
    CASE WHEN v_vi_status = 'disconnected' THEN now() ELSE NULL END,
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

  -- Best-practice (Hard Rule #9): a venue revoking our Stripe Connect access is a rare,
  -- high-impact money-infra event (their payments silently stop). Leave an append-only
  -- server trace with the account + timestamp — disconnected_at alone is overwritten on a
  -- later reconnect→disconnect, whereas audit_events is forensic history. Scoped to the
  -- disconnected transition so routine account.updated churn (onboarding/active/restricted)
  -- doesn't spam the audit log. team_id is NOT NULL → venue_id.
  IF v_vi_status = 'disconnected' THEN
    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (p_venue_id, NULL, 'system', 'stripe_webhook', 'venue_stripe_disconnected',
            'venue_integration', p_account_id,
            jsonb_build_object('venue_id', p_venue_id, 'account_id', p_account_id,
                               'stripe_status', p_status));
  END IF;

  RETURN jsonb_build_object('ok', true, 'venue_id', p_venue_id, 'status', v_vi_status);
END; $fn$;

REVOKE ALL ON FUNCTION public.set_venue_connect_state(text,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_venue_connect_state(text,text,text,boolean,boolean) TO service_role;
