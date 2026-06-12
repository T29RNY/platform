-- 279_membership_stripe_scaffold.sql
--
-- Phase 7 (Stripe) — KEYLESS SCAFFOLDING ONLY. No money moves here. This lays the
-- schema + the server-side state machine / idempotency primitives the webhook +
-- reconciliation cron will call. Everything stays dormant until the operator
-- provides Stripe keys AND signs off the money-flow gate (DECISIONS.md). All adds
-- are additive + nullable; no existing behaviour changes.
--
-- Money model (Stripe Connect, member → venue): each VENUE connects its own Stripe
-- account (money never touches us). Members are Stripe Customers on that connected
-- account; a membership is a Stripe Subscription there. Stripe is the source of
-- truth; these columns are a cache the reconciliation cron repairs.

-- 1. Venue connected-account state.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id  text,
  ADD COLUMN IF NOT EXISTS stripe_connect_status      text NOT NULL DEFAULT 'none'
    CHECK (stripe_connect_status IN ('none','onboarding','active','restricted')),
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted   boolean NOT NULL DEFAULT false;

-- 2. Member ↔ Stripe customer (on the venue's connected account).
ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- 3. Membership ↔ Stripe subscription + a payment_state distinct from the freeze
--    (status) dimension: 'current' (paid), 'past_due' (grace, access continues),
--    'suspended' (access pulled). Driven by Stripe status, never our timers.
ALTER TABLE public.venue_memberships
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id        text,
  ADD COLUMN IF NOT EXISTS payment_state          text NOT NULL DEFAULT 'current'
    CHECK (payment_state IN ('current','past_due','suspended'));
CREATE INDEX IF NOT EXISTS venue_memberships_stripe_sub_idx
  ON public.venue_memberships (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- 4. billing_events becomes the persist-then-process webhook store. Add the
--    membership entity scope + a processing lifecycle + the raw payload. The
--    existing UNIQUE(stripe_event_id) IS the idempotency key (dedupe on retries).
ALTER TABLE public.billing_events DROP CONSTRAINT IF EXISTS billing_events_entity_type_check;
ALTER TABLE public.billing_events ADD CONSTRAINT billing_events_entity_type_check
  CHECK (entity_type IN ('venue','company','membership'));
ALTER TABLE public.billing_events
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processed','failed','ignored')),
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payload      jsonb;

-- 5. record_stripe_event — PERSIST-THEN-PROCESS + IDEMPOTENT. The webhook calls
--    this FIRST (after signature verify). Dedupe is the UNIQUE(stripe_event_id):
--    a replayed event inserts nothing and returns inserted=false so the handler
--    skips re-processing. Returns the current processing status either way.
CREATE OR REPLACE FUNCTION public.record_stripe_event(
  p_stripe_event_id text, p_entity_type text, p_entity_id text,
  p_event_type text, p_amount_pence int, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_id uuid; v_status text;
BEGIN
  INSERT INTO public.billing_events (entity_type, entity_id, event_type, stripe_event_id, amount_pence, payload, status)
  VALUES (p_entity_type, p_entity_id, p_event_type, p_stripe_event_id, p_amount_pence, p_payload, 'received')
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'inserted', true, 'event_id', v_id, 'status', 'received');
  END IF;
  -- duplicate: surface where it got to so the handler can skip
  SELECT id, status INTO v_id, v_status FROM public.billing_events WHERE stripe_event_id = p_stripe_event_id;
  RETURN jsonb_build_object('ok', true, 'inserted', false, 'event_id', v_id, 'status', v_status);
END; $fn$;
REVOKE ALL ON FUNCTION public.record_stripe_event(text,text,text,text,int,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_stripe_event(text,text,text,text,int,jsonb) TO service_role;

-- 6. mark_stripe_event_processed — close the lifecycle after the handler acts.
CREATE OR REPLACE FUNCTION public.mark_stripe_event_processed(
  p_stripe_event_id text, p_status text DEFAULT 'processed', p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF p_status NOT IN ('processed','failed','ignored') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE='P0001';
  END IF;
  UPDATE public.billing_events
     SET status = p_status, processed_at = now(),
         metadata = metadata || jsonb_build_object('note', p_note)
   WHERE stripe_event_id = p_stripe_event_id;
  RETURN jsonb_build_object('ok', FOUND);
END; $fn$;
REVOKE ALL ON FUNCTION public.mark_stripe_event_processed(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stripe_event_processed(text,text,text) TO service_role;

-- 7. apply_membership_subscription_status — THE STATE MACHINE. Maps a Stripe
--    subscription status onto our membership (by stripe_subscription_id):
--      active/trialing      → current (access on)
--      past_due/incomplete  → past_due (grace; access continues)
--      unpaid/inc_expired   → suspended (access pulled)
--      canceled             → suspended + status='cancelled' (sub ended)
--    Access decisions read payment_state; the freeze dimension (status='paused')
--    is member/venue-driven and never overwritten except on a true cancel.
CREATE OR REPLACE FUNCTION public.apply_membership_subscription_status(
  p_subscription_id text, p_stripe_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_pay text; v_m record;
BEGIN
  v_pay := CASE p_stripe_status
    WHEN 'active' THEN 'current'
    WHEN 'trialing' THEN 'current'
    WHEN 'past_due' THEN 'past_due'
    WHEN 'incomplete' THEN 'past_due'
    WHEN 'unpaid' THEN 'suspended'
    WHEN 'incomplete_expired' THEN 'suspended'
    WHEN 'canceled' THEN 'suspended'
    ELSE 'past_due' END;

  UPDATE public.venue_memberships
     SET payment_state = v_pay,
         status = CASE WHEN p_stripe_status = 'canceled' THEN 'cancelled' ELSE status END,
         updated_at = now()
   WHERE stripe_subscription_id = p_subscription_id
  RETURNING id, venue_id, status, payment_state INTO v_m;

  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_membership');
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_m.venue_id, NULL, 'system', 'stripe_webhook', 'membership_payment_state', 'venue_membership', v_m.id::text,
          jsonb_build_object('stripe_status', p_stripe_status, 'payment_state', v_pay, 'status', v_m.status,
                             'subscription_id', p_subscription_id));

  RETURN jsonb_build_object('ok', true, 'membership_id', v_m.id, 'status', v_m.status, 'payment_state', v_m.payment_state);
END; $fn$;
REVOKE ALL ON FUNCTION public.apply_membership_subscription_status(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_membership_subscription_status(text,text) TO service_role;

-- 8. set_venue_connect_state — webhook (account.updated) / onboarding callback
--    writes the venue's connected-account state. service_role only.
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

-- 9. venue_get_billing_status — venue-facing read (gated manage_memberships):
--    connect onboarding state + member payment-state coverage. Powers the venue's
--    "Billing" panel and the "Connect Stripe" CTA.
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
    'total',        count(*),
    'on_stripe',    count(*) FILTER (WHERE stripe_subscription_id IS NOT NULL),
    'current',      count(*) FILTER (WHERE payment_state='current'),
    'past_due',     count(*) FILTER (WHERE payment_state='past_due'),
    'suspended',    count(*) FILTER (WHERE payment_state='suspended')
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
