-- 403_stripe_phase1_safety.sql
-- Phase 1 of the full Stripe build (STRIPE_FULL_BUILD_HANDOFF.md): foundations & safety.
-- Makes Stripe-live SAFE before any new payment feature is layered on. Built/tested under
-- Stripe TEST keys; live keys go in Phase 7 — no path here assumes live keys.
--
--   1. run_membership_renewals — skip memberships with a live stripe_subscription_id.
--      Stripe re-bills subscriptions itself; minting an 'unpaid' ledger charge for one would
--      double-bill AND make the #4 chase engine (mig 398) chase money already paid.
--   2. venue_payments.method — allow 'stripe' so Stripe-collected money is distinguishable
--      from manual cash/card (Phase 6 Stripe-vs-manual reporting split).
--   3. stripe_customers — one Stripe customer per (payer human, connected account). A payer
--      (incl. a guardian paying for a child) saves ONE card and reuses it across enrolments.
--   4. stripe_record_invoice_payment / stripe_record_refund — record recurring Stripe invoice
--      payments and refunds into the venue_charges/venue_payments ledger so no payment is
--      silently lost. Idempotent; the 04:00 reconciliation cron repairs dropped webhooks.
--   5. stripe_complete_member_enrolment — also persist payer_profile_id (Phase 2 enabler:
--      "memberships I pay for as guardian"). Signature gains a trailing p_payer_profile_id.
--
-- All new write surfaces are service_role-only (webhook + cron callers), SECURITY DEFINER,
-- search_path pinned, audited (Hard Rule #9). audit_events.team_id is NOT NULL → venue_id.

-- ── 1. renewal guard: skip live Stripe subscriptions in loop (c) ───────────────
CREATE OR REPLACE FUNCTION public.run_membership_renewals()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_m record; v_s record; v_minted int := 0; v_reactivated int := 0; v_ended int := 0;
BEGIN
  -- (a) reactivate freezes whose window has passed
  UPDATE public.venue_memberships
     SET status='active', frozen_until=NULL, updated_at=now()
   WHERE status='paused' AND frozen_until IS NOT NULL AND frozen_until <= current_date;
  GET DIAGNOSTICS v_reactivated = ROW_COUNT;

  -- (b) ending memberships reaching term → cancelled
  UPDATE public.venue_memberships
     SET status='cancelled', updated_at=now()
   WHERE status='ending' AND renews_at <= current_date;
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  -- (c) due active RECURRING memberships → mint next charge, advance renews_at.
  --     season excluded: one-off billing at enrolment, no recurring charge.
  --     stripe_subscription_id excluded: Stripe re-bills the sub itself and the
  --     invoice.paid webhook records the ledger charge — minting here would double-bill.
  FOR v_m IN
    SELECT id, venue_id, amount_pence, period, renews_at
      FROM public.venue_memberships
     WHERE status='active' AND renews_at <= current_date AND period <> 'season'
       AND stripe_subscription_id IS NULL
     FOR UPDATE
  LOOP
    INSERT INTO public.venue_charges
      (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_m.venue_id, 'membership', v_m.id::text || ':' || v_m.renews_at::text,
            NULL, NULL, v_m.amount_pence, 'unpaid', v_m.renews_at)
    ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;
    UPDATE public.venue_memberships
       SET renews_at = renews_at + public._membership_period_interval(period), updated_at=now()
     WHERE id = v_m.id;
    v_minted := v_minted + 1;
  END LOOP;

  -- (d) due active fee subscriptions → mint next charge, advance next_charge_at
  FOR v_s IN
    SELECT s.id, s.venue_id, s.team_id, s.next_charge_at, fp.amount_pence, fp.period
      FROM public.venue_fee_subscriptions s
      JOIN public.venue_fee_plans fp ON fp.id = s.plan_id
     WHERE s.status='active' AND s.next_charge_at <= current_date
     FOR UPDATE OF s
  LOOP
    INSERT INTO public.venue_charges
      (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_s.venue_id, 'fee', v_s.id::text || ':' || v_s.next_charge_at::text,
            v_s.team_id, NULL, v_s.amount_pence, 'unpaid', v_s.next_charge_at)
    ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;
    UPDATE public.venue_fee_subscriptions
       SET next_charge_at = next_charge_at + public._membership_period_interval(v_s.period)
     WHERE id = v_s.id;
    v_minted := v_minted + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'minted', v_minted,
                            'reactivated', v_reactivated, 'ended', v_ended);
END;
$fn$;
REVOKE ALL ON FUNCTION public.run_membership_renewals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_membership_renewals() TO service_role;

-- ── 2. allow method='stripe' on the ledger ────────────────────────────────────
ALTER TABLE public.venue_payments DROP CONSTRAINT IF EXISTS venue_payments_method_check;
ALTER TABLE public.venue_payments ADD CONSTRAINT venue_payments_method_check
  CHECK (method = ANY (ARRAY['cash','bank_transfer','card','other','stripe']));

-- ── 3. one Stripe customer per (payer human, connected account) ────────────────
CREATE TABLE IF NOT EXISTS public.stripe_customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_profile_id   uuid NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  account_id         text NOT NULL,           -- Stripe connected account the customer lives on
  stripe_customer_id text NOT NULL,
  email              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payer_profile_id, account_id)
);
ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;
-- No RLS policies: definer-only access (webhook/checkout via service_role + SECDEF RPCs).

-- Return the existing mapped customer for (payer, account); if p_new_customer_id is given and
-- none exists, persist it (race-safe via ON CONFLICT) and return the winning row; else null.
CREATE OR REPLACE FUNCTION public.get_or_link_stripe_customer(
  p_payer_profile_id uuid, p_account_id text, p_venue_id text,
  p_new_customer_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_existing text; v_email text;
BEGIN
  IF p_payer_profile_id IS NULL OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'missing_params' USING ERRCODE='P0001';
  END IF;

  SELECT stripe_customer_id INTO v_existing
    FROM public.stripe_customers
   WHERE payer_profile_id = p_payer_profile_id AND account_id = p_account_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'stripe_customer_id', v_existing, 'reused', true);
  END IF;

  IF p_new_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'stripe_customer_id', NULL, 'reused', false);
  END IF;

  SELECT email INTO v_email FROM public.member_profiles WHERE id = p_payer_profile_id;

  INSERT INTO public.stripe_customers (payer_profile_id, account_id, stripe_customer_id, email)
  VALUES (p_payer_profile_id, p_account_id, p_new_customer_id, v_email)
  ON CONFLICT (payer_profile_id, account_id) DO NOTHING;

  -- Re-select: a concurrent insert may have won; we always return the persisted winner.
  SELECT stripe_customer_id INTO v_existing
    FROM public.stripe_customers
   WHERE payer_profile_id = p_payer_profile_id AND account_id = p_account_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(p_venue_id, p_account_id), NULL, 'system', 'stripe_checkout',
          'stripe_customer_linked', 'stripe_customer', p_payer_profile_id::text,
          jsonb_build_object('account_id', p_account_id, 'venue_id', p_venue_id,
                             'stripe_customer_id', v_existing,
                             'created', (v_existing = p_new_customer_id)));

  RETURN jsonb_build_object('ok', true, 'stripe_customer_id', v_existing,
                            'reused', (v_existing <> p_new_customer_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_or_link_stripe_customer(uuid,text,text,text) FROM PUBLIC;
-- Supabase default privileges auto-grant EXECUTE to anon+authenticated on new functions;
-- REVOKE ALL ... FROM PUBLIC does NOT strip role-level grants. Explicitly revoke them: this
-- is a service_role-only (checkout/webhook) RPC, never client-callable.
REVOKE EXECUTE ON FUNCTION public.get_or_link_stripe_customer(uuid,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_link_stripe_customer(uuid,text,text,text) TO service_role;

-- ── 4a. record a paid Stripe subscription invoice into the ledger ──────────────
-- Mints one idempotent venue_charge per invoice + a 'stripe' payment, then recomputes
-- status. external_ref = the Stripe CHARGE id (what refund events reference), so a later
-- refund can find this payment. Idempotent on (charge source_id) and (charge_id, invoice_id).
CREATE OR REPLACE FUNCTION public.stripe_record_invoice_payment(
  p_subscription_id text, p_invoice_id text, p_charge_ref text,
  p_amount_pence integer, p_paid_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_m record; v_charge_id uuid; v_source_id text; v_extref text; v_exists boolean;
BEGIN
  IF p_subscription_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'missing_params' USING ERRCODE='P0001';
  END IF;

  SELECT id, venue_id, amount_pence INTO v_m
    FROM public.venue_memberships WHERE stripe_subscription_id = p_subscription_id;
  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_membership');
  END IF;

  v_source_id := v_m.id::text || ':inv:' || p_invoice_id;
  v_extref    := COALESCE(p_charge_ref, p_invoice_id);

  INSERT INTO public.venue_charges
    (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  VALUES (v_m.venue_id, 'membership', v_source_id, NULL, NULL,
          COALESCE(p_amount_pence, v_m.amount_pence), 'unpaid', (p_paid_at AT TIME ZONE 'UTC')::date)
  ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;

  SELECT id INTO v_charge_id FROM public.venue_charges
   WHERE source_type='membership' AND source_id=v_source_id AND COALESCE(team_id,'')='';

  SELECT EXISTS(SELECT 1 FROM public.venue_payments
                 WHERE charge_id=v_charge_id AND external_ref=v_extref
                   AND kind='payment' AND voided_at IS NULL) INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.venue_payments (charge_id, kind, amount_pence, method, external_ref, note, taken_by)
    VALUES (v_charge_id, 'payment', COALESCE(p_amount_pence, v_m.amount_pence), 'stripe',
            v_extref, 'Stripe subscription invoice ' || p_invoice_id, 'stripe_webhook');
    PERFORM public._recompute_charge_status(v_charge_id);

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_m.venue_id, NULL, 'system', 'stripe_webhook', 'membership_invoice_paid',
            'venue_charge', v_charge_id::text,
            jsonb_build_object('subscription_id', p_subscription_id, 'invoice_id', p_invoice_id,
                               'charge_ref', v_extref, 'membership_id', v_m.id,
                               'amount_pence', COALESCE(p_amount_pence, v_m.amount_pence)));
  END IF;

  RETURN jsonb_build_object('ok', true, 'charge_id', v_charge_id, 'recorded', NOT v_exists,
                            'charge_status', (SELECT status FROM public.venue_charges WHERE id=v_charge_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_record_invoice_payment(text,text,text,integer,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_record_invoice_payment(text,text,text,integer,timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_record_invoice_payment(text,text,text,integer,timestamptz) TO service_role;

-- ── 4b. record a Stripe refund against the original ledger payment ─────────────
-- Finds the non-voided 'stripe' payment by external_ref (the charge id) and appends a
-- 'refund' row (positive amount; _recompute_charge_status subtracts it). Idempotent on
-- the Stripe refund id, so replays / charge.refunded re-fires are no-ops.
CREATE OR REPLACE FUNCTION public.stripe_record_refund(
  p_charge_ref text, p_amount_pence integer, p_refund_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_pay record; v_charge record;
BEGIN
  IF p_charge_ref IS NULL OR p_refund_id IS NULL THEN
    RAISE EXCEPTION 'missing_params' USING ERRCODE='P0001';
  END IF;

  IF EXISTS(SELECT 1 FROM public.venue_payments WHERE external_ref=p_refund_id AND kind='refund') THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false, 'reason', 'already');
  END IF;

  SELECT id, charge_id, amount_pence INTO v_pay
    FROM public.venue_payments
   WHERE external_ref=p_charge_ref AND kind='payment' AND voided_at IS NULL
   ORDER BY taken_at DESC LIMIT 1;
  IF v_pay.charge_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_payment');
  END IF;

  SELECT id, venue_id, team_id INTO v_charge FROM public.venue_charges WHERE id=v_pay.charge_id;

  INSERT INTO public.venue_payments (charge_id, kind, amount_pence, method, external_ref, note, taken_by)
  VALUES (v_pay.charge_id, 'refund', ABS(COALESCE(p_amount_pence, v_pay.amount_pence)), 'stripe',
          p_refund_id, 'Stripe refund ' || p_refund_id, 'stripe_webhook');
  PERFORM public._recompute_charge_status(v_pay.charge_id);

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_charge.team_id, v_charge.venue_id), NULL, 'system', 'stripe_webhook',
          'membership_refunded', 'venue_charge', v_pay.charge_id::text,
          jsonb_build_object('charge_ref', p_charge_ref, 'refund_id', p_refund_id,
                             'amount_pence', ABS(COALESCE(p_amount_pence, v_pay.amount_pence))));

  RETURN jsonb_build_object('ok', true, 'recorded', true, 'charge_id', v_pay.charge_id,
                            'charge_status', (SELECT status FROM public.venue_charges WHERE id=v_pay.charge_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_record_refund(text,integer,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_record_refund(text,integer,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_record_refund(text,integer,text) TO service_role;

-- ── 5. stripe_complete_member_enrolment — persist payer_profile_id ─────────────
-- Adds a trailing p_payer_profile_id (the human who paid; the caller, incl. a guardian).
-- DROP the old 8-arg signature first (CREATE OR REPLACE can't change the arg list, and a
-- leftover overload would cause "could not choose best candidate").
DROP FUNCTION IF EXISTS public.stripe_complete_member_enrolment(text,text,text,text,uuid,text,uuid,integer);
CREATE OR REPLACE FUNCTION public.stripe_complete_member_enrolment(
  p_invite_code text, p_subscription_id text, p_stripe_customer_id text, p_stripe_price_id text,
  p_tier_id uuid, p_period text, p_member_profile_id uuid,
  p_amount_pence integer DEFAULT NULL, p_payer_profile_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_link      record;
  v_venue_id  text;
  v_club_id   text;
  v_tier      record;
  v_price     int;
  v_renews    date;
  v_mid       uuid;
  v_pass      text;
  v_actor_uid uuid;
BEGIN
  IF p_subscription_id IS NOT NULL THEN
    SELECT id, pass_token INTO v_mid, v_pass
    FROM public.venue_memberships
    WHERE stripe_subscription_id = p_subscription_id;
    IF v_mid IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'membership_id', v_mid,
                                'pass_token', v_pass, 'already_enrolled', true);
    END IF;
  END IF;

  SELECT entity_id, active INTO v_link
  FROM public.invite_links
  WHERE code = btrim(p_invite_code)
    AND entity_type = 'venue'
    AND action = 'venue_landing';
  IF NOT FOUND OR NOT v_link.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  v_venue_id := v_link.entity_id;

  IF p_period NOT IN ('monthly','quarterly','annual','season') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_period');
  END IF;

  SELECT id, season_start, season_end, pricing_model, proration_basis, joining_fee_pence
    INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_not_found');
  END IF;

  IF p_amount_pence IS NOT NULL THEN
    v_price := p_amount_pence;
  ELSE
    SELECT price_pence INTO v_price
    FROM public.venue_tier_prices
    WHERE tier_id = p_tier_id AND period = p_period AND active;
    IF v_tier.pricing_model = 'season' THEN
      v_price := COALESCE(v_tier.joining_fee_pence, 0)
               + public._prorated_first_charge(v_price, COALESCE(v_tier.proration_basis,'none'),
                                               current_date, v_tier.season_start, v_tier.season_end);
    END IF;
  END IF;

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  IF p_period = 'season' THEN
    v_renews := COALESCE(v_tier.season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, payer_profile_id, pricing_model,
    stripe_subscription_id, stripe_customer_id, stripe_price_id, payment_state
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_price, 'active', v_renews,
    v_club_id, p_member_profile_id, COALESCE(p_payer_profile_id, p_member_profile_id),
    CASE WHEN v_tier.pricing_model = 'season' THEN 'term' ELSE COALESCE(v_tier.pricing_model,'recurring') END,
    p_subscription_id, p_stripe_customer_id, p_stripe_price_id, 'current'
  )
  RETURNING id, pass_token INTO v_mid, v_pass;

  SELECT auth_user_id INTO v_actor_uid
  FROM public.member_profiles WHERE id = p_member_profile_id;

  IF v_actor_uid IS NOT NULL THEN
    INSERT INTO public.audit_events (
      team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
    ) VALUES (
      v_venue_id, v_actor_uid, 'player', 'stripe_member_enrolled',
      'venue_membership', v_mid::text,
      jsonb_build_object(
        'tier_id',                p_tier_id,
        'period',                 p_period,
        'member_profile_id',      p_member_profile_id,
        'payer_profile_id',       COALESCE(p_payer_profile_id, p_member_profile_id),
        'club_id',                v_club_id,
        'amount_pence',           v_price,
        'stripe_subscription_id', p_subscription_id,
        'stripe_customer_id',     p_stripe_customer_id
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid, 'pass_token', v_pass);
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_complete_member_enrolment(text,text,text,text,uuid,text,uuid,integer,uuid) FROM PUBLIC;
-- DROP+recreate lost the prior service_role-only lockdown; re-revoke the default role grants.
REVOKE EXECUTE ON FUNCTION public.stripe_complete_member_enrolment(text,text,text,text,uuid,text,uuid,integer,uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_complete_member_enrolment(text,text,text,text,uuid,text,uuid,integer,uuid) TO service_role;
