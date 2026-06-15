-- 329_venue_integrations.sql
--
-- Phase 1: Payment Infrastructure foundation.
-- Creates the shared `venue_integrations` table as the canonical store for
-- third-party payment provider credentials (Stripe Connect, GoCardless for
-- Platforms). Replaces the four Stripe-specific columns mig 279 added to
-- `venues`, which are dormant (no live data — Stripe is not yet connected).
-- `venue_memberships` + `venue_customers` stripe columns are left untouched
-- (per-membership operational state, not integration credentials).

-- ── 1. venue_integrations table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_integrations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  provider      text        NOT NULL CHECK (provider IN ('stripe','gocardless')),
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','connected','disconnected')),
  account_id    text,
  access_token  text,
  config        jsonb       NOT NULL DEFAULT '{}',
  connected_at  timestamptz,
  disconnected_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_integrations_venue_provider_key UNIQUE (venue_id, provider)
);

ALTER TABLE public.venue_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_integrations FROM PUBLIC, anon, authenticated;

-- ── 2. Drop dormant Stripe columns from venues ─────────────────────────────
-- These columns were added by mig 279 as Stripe-specific scaffolding. They
-- have never held live data. The canonical home for provider credentials is
-- now venue_integrations.

ALTER TABLE public.venues
  DROP COLUMN IF EXISTS stripe_connect_account_id,
  DROP COLUMN IF EXISTS stripe_connect_status,
  DROP COLUMN IF EXISTS stripe_charges_enabled,
  DROP COLUMN IF EXISTS stripe_details_submitted;

-- ── 3. Rewrite set_venue_connect_state ─────────────────────────────────────
-- Now upserts into venue_integrations instead of writing to venues.* columns.
-- service_role only (called from webhook/onboarding callback server-side).

DROP FUNCTION IF EXISTS public.set_venue_connect_state(text, text, text, boolean, boolean);

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

-- ── 4. Rewrite venue_get_billing_status ────────────────────────────────────
-- Now reads from venue_integrations instead of venues.stripe_* columns.
-- Extends to return both providers (stripe + gocardless) so the UI gets
-- a single payload for both provider cards.

DROP FUNCTION IF EXISTS public.venue_get_billing_status(text);

CREATE OR REPLACE FUNCTION public.venue_get_billing_status(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_stripe   record;
  v_gc       record;
  v_members  jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  -- Stripe integration row (may not exist yet)
  SELECT status, account_id, config, connected_at, disconnected_at
    INTO v_stripe
    FROM public.venue_integrations
   WHERE venue_id = v_venue_id AND provider = 'stripe';

  -- GoCardless integration row (may not exist yet)
  SELECT status, account_id, config, connected_at, disconnected_at
    INTO v_gc
    FROM public.venue_integrations
   WHERE venue_id = v_venue_id AND provider = 'gocardless';

  -- Member payment-state summary (Stripe-driven, used by Phase 3+)
  SELECT jsonb_build_object(
    'total',      count(*),
    'on_stripe',  count(*) FILTER (WHERE stripe_subscription_id IS NOT NULL),
    'current',    count(*) FILTER (WHERE payment_state = 'current'),
    'past_due',   count(*) FILTER (WHERE payment_state = 'past_due'),
    'suspended',  count(*) FILTER (WHERE payment_state = 'suspended')
  ) INTO v_members
    FROM public.venue_memberships
   WHERE venue_id = v_venue_id AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'ok', true,
    'stripe', jsonb_build_object(
      'connected',         v_stripe.status = 'connected',
      'status',            COALESCE(v_stripe.status, 'pending'),
      'account_id',        v_stripe.account_id,
      'config',            COALESCE(v_stripe.config, '{}'),
      'connected_at',      v_stripe.connected_at,
      'disconnected_at',   v_stripe.disconnected_at
    ),
    'gocardless', jsonb_build_object(
      'connected',       v_gc.status = 'connected',
      'status',          COALESCE(v_gc.status, 'pending'),
      'account_id',      v_gc.account_id,
      'connected_at',    v_gc.connected_at,
      'disconnected_at', v_gc.disconnected_at
    ),
    'members', COALESCE(v_members, '{}'::jsonb)
  );
END; $fn$;

REVOKE ALL ON FUNCTION public.venue_get_billing_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_get_billing_status(text) TO anon, authenticated;
