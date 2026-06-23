-- 407_stripe_phase5_lifecycle.sql
-- Phase 5 of the full Stripe build (STRIPE_FULL_BUILD_HANDOFF.md): lifecycle management —
-- Billing Portal (#11), bulk price change (#12 + pro-rated #20), Stripe refunds (#13 +
-- pro-rated #21). Built/tested under Stripe TEST keys; live keys go in Phase 7 — no path
-- here assumes live keys.
--
-- LIFECYCLE ON TOP OF EXISTING OBJECTS — not a new money path:
--   • Billing Portal: NO SQL. The member's reused customer (venue_memberships.stripe_customer_id)
--     + connected account (venue_integrations) are read in api/stripe-billing-portal.js; a
--     member cancelling there fires customer.subscription.updated/deleted which the webhook
--     ALREADY routes to apply_membership_subscription_status. Nothing new server-side.
--   • Refunds: the charge.refunded webhook ALREADY reconciles a Stripe refund into the ledger
--     via stripe_record_refund (mig 403, idempotent on the refund id). Phase 5 only INITIATES
--     the refund (api/stripe-refund.js). This file adds ONE read resolver so the API knows the
--     Stripe charge id + the refundable / pro-rated-unused amounts (maths stays in the one
--     _prorated_first_charge engine, mig 393).
--   • Price change: OPERATOR DECISION (session 186, "Option A") — a mid-cycle increase applies
--     at the NEXT renewal, never a surprise mid-month top-up (member's favour). So there is NO
--     Stripe mid-cycle proration: api/stripe-price-change.js pushes the new price with
--     proration_behavior:'none'. Cash members: amount_pence updated here (the renewal cron
--     mints the next charge at the new rate). Stripe members: amount_pence is updated ONLY
--     after Stripe accepts the push, via stripe_set_membership_price (no DB↔Stripe drift).
--   • Season-schedule members (Phase 4, stripe_schedule_id set) are EXCLUDED from the bulk
--     price push for Phase 5 (operator re-prices those at next season) — flagged in the preview.
--
-- Venue write RPCs: SECDEF, search_path pinned, gated on manage_memberships via _venue_has_cap,
-- audited (Hard Rule #9), granted anon+authenticated (auth enforced inside resolve_venue_caller —
-- the venue_* gotcha). stripe_set_membership_price is service_role-only (webhook/API caller).

-- ── 1. venue_price_change_preview (READ) ───────────────────────────────────────
-- Reuses _bulk_cohort_memberships (single source of truth for "who's in the cohort"),
-- joined back to venue_memberships for the Stripe fields. Classifies each member:
--   left / paused                         → skip (locked, like the bulk-charge preview)
--   stripe_schedule_id IS NOT NULL        → skip 'season_schedule' (excluded this phase)
--   stripe_subscription_id IS NOT NULL    → 'stripe' (the API pushes the new price)
--   else                                  → 'cash'   (commit updates amount_pence)
CREATE OR REPLACE FUNCTION public.venue_price_change_preview(
  p_venue_token   text,
  p_cohort_type   text,
  p_cohort_ref    text,
  p_new_price_pence int,
  p_effective_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_cohort_type NOT IN ('tier','club','team') THEN
    RAISE EXCEPTION 'invalid_cohort_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_price_pence IS NULL OR p_new_price_pence < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  WITH cohort AS (
    SELECT * FROM public._bulk_cohort_memberships(v_venue_id, p_cohort_type, p_cohort_ref)
  ),
  joined AS (
    SELECT c.membership_id,
           COALESCE(c.member_name, 'Member') AS member_name,
           c.status, c.frozen_until,
           vm.amount_pence            AS old_amount_pence,
           vm.stripe_subscription_id,
           vm.stripe_schedule_id,
           vm.period
    FROM cohort c
    JOIN public.venue_memberships vm ON vm.id = c.membership_id
  ),
  scored AS (
    SELECT j.*,
      CASE
        WHEN j.status = 'ending' THEN 'left'
        WHEN j.status = 'paused' OR (j.frozen_until IS NOT NULL AND j.frozen_until > current_date) THEN 'paused'
        WHEN j.stripe_schedule_id IS NOT NULL THEN 'season_schedule'
        ELSE NULL
      END AS skip_reason,
      CASE WHEN j.stripe_subscription_id IS NOT NULL THEN 'stripe' ELSE 'cash' END AS method
    FROM joined j
  )
  SELECT jsonb_build_object(
    'ok', true,
    'cohort_type', p_cohort_type,
    'cohort_ref',  p_cohort_ref,
    'new_price_pence', p_new_price_pence,
    'effective_date',  p_effective_date,
    'member_count',  (SELECT count(*) FROM scored),
    'include_count', (SELECT count(*) FROM scored WHERE skip_reason IS NULL),
    'stripe_count',  (SELECT count(*) FROM scored WHERE skip_reason IS NULL AND method = 'stripe'),
    'cash_count',    (SELECT count(*) FROM scored WHERE skip_reason IS NULL AND method = 'cash'),
    'skip_count',    (SELECT count(*) FROM scored WHERE skip_reason IS NOT NULL),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'membership_id',    membership_id,
        'member_name',      member_name,
        'status',           status,
        'period',           period,
        'old_amount_pence', old_amount_pence,
        'new_amount_pence', p_new_price_pence,
        'method',           method,
        'will_change',      (skip_reason IS NULL),
        'skip_reason',      skip_reason
      ) ORDER BY (skip_reason IS NOT NULL), member_name) FROM scored
    ), '[]'::jsonb)
  ) INTO v_rows;

  RETURN v_rows;
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_price_change_preview(text,text,text,int,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_price_change_preview(text,text,text,int,date) TO anon, authenticated;

-- ── 2. venue_bulk_price_change_commit (WRITE) ──────────────────────────────────
-- Cash members: amount_pence updated NOW (the renewal cron mints the next charge at the new
-- rate → applies at next renewal, the Option-A policy). Stripe members: NOT updated here —
-- returned as stripe_targets so api/stripe-price-change.js pushes to Stripe first, then calls
-- stripe_set_membership_price (below) on success, so our record never runs ahead of Stripe.
-- Schedule-backed + paused + left members are skipped (mirrors the preview). Idempotent:
-- re-running sets the same amount_pence and returns the same targets.
CREATE OR REPLACE FUNCTION public.venue_bulk_price_change_commit(
  p_venue_token   text,
  p_cohort_type   text,
  p_cohort_ref    text,
  p_new_price_pence int,
  p_effective_date date   DEFAULT NULL,
  p_excluded_ids   uuid[] DEFAULT '{}'::uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_excluded uuid[] := COALESCE(p_excluded_ids, '{}'::uuid[]);
  v_cash_updated int := 0;
  v_targets jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_cohort_type NOT IN ('tier','club','team') THEN
    RAISE EXCEPTION 'invalid_cohort_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_price_pence IS NULL OR p_new_price_pence < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  -- the included, changeable set (active, not paused/frozen, not excluded, not schedule-backed)
  WITH cohort AS (
    SELECT * FROM public._bulk_cohort_memberships(v_venue_id, p_cohort_type, p_cohort_ref)
  ),
  changeable AS (
    SELECT c.membership_id, vm.stripe_subscription_id, vm.stripe_customer_id
    FROM cohort c
    JOIN public.venue_memberships vm ON vm.id = c.membership_id
    WHERE c.status = 'active'
      AND NOT (c.frozen_until IS NOT NULL AND c.frozen_until > current_date)
      AND vm.stripe_schedule_id IS NULL
      AND NOT (c.membership_id = ANY (v_excluded))
  ),
  -- cash members: apply the new rate to our record immediately
  upd AS (
    UPDATE public.venue_memberships vm
       SET amount_pence = p_new_price_pence, updated_at = now()
      FROM changeable ch
     WHERE vm.id = ch.membership_id
       AND ch.stripe_subscription_id IS NULL
       AND vm.amount_pence IS DISTINCT FROM p_new_price_pence
    RETURNING vm.id
  )
  SELECT (SELECT count(*) FROM upd),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'membership_id',   membership_id,
            'subscription_id', stripe_subscription_id,
            'customer_id',     stripe_customer_id))
          FROM changeable WHERE stripe_subscription_id IS NOT NULL), '[]'::jsonb)
    INTO v_cash_updated, v_targets;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'bulk_price_change', 'venue', v_venue_id,
          jsonb_build_object('cohort_type', p_cohort_type, 'cohort_ref', p_cohort_ref,
                             'new_price_pence', p_new_price_pence, 'effective_date', p_effective_date,
                             'cash_updated', v_cash_updated,
                             'stripe_targets', jsonb_array_length(v_targets),
                             'excluded', v_excluded));

  PERFORM public.notify_venue_change(v_venue_id, 'membership_updated');

  RETURN jsonb_build_object('ok', true, 'venue_id', v_venue_id,
                            'new_price_pence', p_new_price_pence,
                            'cash_updated', v_cash_updated,
                            'stripe_targets', v_targets);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_bulk_price_change_commit(text,text,text,int,date,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_bulk_price_change_commit(text,text,text,int,date,uuid[]) TO anon, authenticated;

-- ── 3. stripe_set_membership_price (WRITE, service_role API/webhook-only) ───────
-- Called by api/stripe-price-change.js AFTER Stripe accepts the new price on the sub, so our
-- amount_pence + stripe_price_id never run ahead of Stripe. Audited. Idempotent.
CREATE OR REPLACE FUNCTION public.stripe_set_membership_price(
  p_membership_id uuid, p_amount_pence int, p_stripe_price_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_m record;
BEGIN
  IF p_membership_id IS NULL OR p_amount_pence IS NULL THEN
    RAISE EXCEPTION 'missing_params' USING ERRCODE='P0001';
  END IF;

  SELECT id, venue_id INTO v_m FROM public.venue_memberships WHERE id = p_membership_id;
  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_membership');
  END IF;

  UPDATE public.venue_memberships
     SET amount_pence    = p_amount_pence,
         stripe_price_id = COALESCE(p_stripe_price_id, stripe_price_id),
         updated_at      = now()
   WHERE id = p_membership_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_m.venue_id, NULL, 'system', 'stripe_price_change', 'membership_price_pushed',
          'venue_membership', p_membership_id::text,
          jsonb_build_object('amount_pence', p_amount_pence, 'stripe_price_id', p_stripe_price_id));

  RETURN jsonb_build_object('ok', true, 'membership_id', p_membership_id, 'amount_pence', p_amount_pence);
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_set_membership_price(uuid,int,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_set_membership_price(uuid,int,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_set_membership_price(uuid,int,text) TO service_role;

-- ── 4. venue_refund_charge_resolve (READ) ──────────────────────────────────────
-- The refund API (api/stripe-refund.js) calls this to learn (a) the Stripe charge id to refund
-- (external_ref of the original non-voided 'stripe' payment), (b) how much is still refundable
-- (paid − already-refunded), and (c) the pro-rated "unused portion" for a leaver, via the SAME
-- _prorated_first_charge engine so the on-screen number and the Stripe refund agree. Read-only,
-- gated, no audit (the refund itself is audited by stripe_record_refund when it lands).
CREATE OR REPLACE FUNCTION public.venue_refund_charge_resolve(
  p_venue_token text, p_charge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_charge record;
  v_charge_ref text;
  v_paid int;
  v_refunded int;
  v_refundable int;
  v_m record;
  v_prorated int;
  v_is_season boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, venue_id, source_type, source_id INTO v_charge
    FROM public.venue_charges WHERE id = p_charge_id;
  IF v_charge.id IS NULL THEN RAISE EXCEPTION 'charge_not_found' USING ERRCODE='P0001'; END IF;
  IF v_charge.venue_id <> v_venue_id THEN RAISE EXCEPTION 'charge_not_in_venue' USING ERRCODE='P0001'; END IF;

  -- the Stripe charge id behind the most recent non-voided 'stripe' payment on this charge
  SELECT external_ref INTO v_charge_ref
    FROM public.venue_payments
   WHERE charge_id = p_charge_id AND kind = 'payment' AND method = 'stripe' AND voided_at IS NULL
   ORDER BY taken_at DESC LIMIT 1;

  -- refundable = collected (non-voided stripe payments) − already-refunded (refund rows)
  SELECT COALESCE(SUM(amount_pence) FILTER (WHERE kind='payment' AND method='stripe' AND voided_at IS NULL), 0),
         COALESCE(SUM(amount_pence) FILTER (WHERE kind='refund'), 0)
    INTO v_paid, v_refunded
    FROM public.venue_payments WHERE charge_id = p_charge_id;
  v_refundable := GREATEST(v_paid - v_refunded, 0);

  -- pro-rated unused slice (season memberships only): the part of the season from today → end.
  -- Same helper the joining-charge uses, so the leaver refund mirrors the joining proration.
  IF v_charge.source_type = 'membership' THEN
    SELECT vm.id, t.season_start, t.season_end, COALESCE(t.proration_basis,'none') AS basis,
           (vm.pricing_model = 'term' OR t.pricing_model = 'season') AS is_season
      INTO v_m
      FROM public.venue_memberships vm
      LEFT JOIN public.venue_membership_tiers t ON t.id = vm.tier_id
     WHERE vm.id::text = split_part(v_charge.source_id, ':', 1);
    IF v_m.id IS NOT NULL AND v_m.is_season AND v_m.season_start IS NOT NULL AND v_m.season_end IS NOT NULL THEN
      v_is_season := true;
      v_prorated := public._prorated_first_charge(v_refundable, v_m.basis, current_date,
                                                  v_m.season_start, v_m.season_end);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'charge_id',             p_charge_id,
    'venue_id',              v_venue_id,
    'stripe_charge_ref',     v_charge_ref,
    'paid_pence',            v_paid,
    'refunded_pence',        v_refunded,
    'refundable_pence',      v_refundable,
    'is_season',             v_is_season,
    'prorated_unused_pence', v_prorated
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_refund_charge_resolve(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_refund_charge_resolve(text,uuid) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
