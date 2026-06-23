-- 406_stripe_phase4_schedules.sql
-- Phase 4 of the full Stripe build (STRIPE_FULL_BUILD_HANDOFF.md): fixed-term & dated billing
-- (scope #9 Subscription Schedules, #10 future start-date anchoring, #19 mid-cycle proration as
-- equal instalments). Built/tested under Stripe TEST keys; live keys go in Phase 7 — no path
-- here assumes live keys.
--
-- DESIGN (operator-confirmed, session 184):
--   - A tier with pricing_model='season' billed on a RECURRING cadence (monthly/quarterly/annual)
--     is a "season schedule" plan: it bills EQUAL instalments from the season start (or signup,
--     mid-season) and AUTO-STOPS at season end. period='season' stays a one-off (mode=payment)
--     exactly as today; pricing_model='recurring' stays open-ended — both BYTE-IDENTICAL.
--   - A late joiner pays ONLY for the part of the season remaining (Option 1), spread as EQUAL
--     instalments — every charge identical, computed by US (not Stripe's exact second-based
--     proration), so the member sees one number that matches the ledger + on-screen breakdown.
--     _season_instalment_plan is the single engine; it reuses _prorated_first_charge (mig 393,
--     Option A — round in the member's favour) for the remaining-season total.
--   - An early joiner (signed up before season start) pays nothing until the season start date.
--
--   1. venue_memberships += stripe_schedule_id, phase_end_at, billing_starts_at (additive nullable).
--   2. run_membership_renewals — also skip schedule-backed / future-anchored subs (Stripe bills
--      those itself; minting a ledger charge here would double-bill AND make #4 chase money already
--      paid), exactly like it already skips a live stripe_subscription_id (mig 403).
--   3. _season_instalment_plan(...) — STABLE internal helper: per-instalment pence + instalment
--      count + billing-start date, for /api/stripe-member-checkout.js to size the Stripe
--      subscription line + anchor. service_role-only (checkout calls it with the service key).
--   4. stripe_record_season_payment(...) — service_role webhook-only: reconciles a PAID season
--      one-off (mode=payment emits NO invoice, so the mig-405 invoice path can't catch it) into
--      the venue_charges/venue_payments ledger so it surfaces in get_my_money() as paid. Idempotent.

-- ── 1. schedule / anchor metadata (additive, nullable — no regression to today) ──
ALTER TABLE public.venue_memberships
  ADD COLUMN IF NOT EXISTS stripe_schedule_id text,
  ADD COLUMN IF NOT EXISTS phase_end_at        date,
  ADD COLUMN IF NOT EXISTS billing_starts_at   date;

-- ── 2. renewal guard: skip schedule-backed / future-anchored subs in loop (c) ────
-- Identical to mig 403 except the loop-(c) WHERE gains stripe_schedule_id IS NULL and a
-- billing_starts_at future guard. Schedule subs already carry a stripe_subscription_id (so were
-- skipped); these clauses are belt-and-braces for the future-anchor window before the first charge.
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
  --     stripe_subscription_id / stripe_schedule_id excluded: Stripe re-bills the sub/schedule
  --     itself and the invoice.paid webhook records the ledger charge — minting here would
  --     double-bill. billing_starts_at in the future excluded: a future-anchored sub has not
  --     begun billing, so there is nothing to mirror yet.
  FOR v_m IN
    SELECT id, venue_id, amount_pence, period, renews_at
      FROM public.venue_memberships
     WHERE status='active' AND renews_at <= current_date AND period <> 'season'
       AND stripe_subscription_id IS NULL
       AND stripe_schedule_id IS NULL
       AND (billing_starts_at IS NULL OR billing_starts_at <= current_date)
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

-- ── 3. _season_instalment_plan — the single equal-instalment engine ─────────────
-- Late joiners pay only for the remaining part of the season (Option 1), spread as equal
-- instalments. Counts cadence charge-dates across the whole season + from the billing start,
-- takes the remaining-season total from _prorated_first_charge (Option A), divides into equal
-- instalments rounded DOWN (member never overpays). Early joiner → billing_start = season_start
-- (no charge until then); mid-season joiner → billing_start = today.
CREATE OR REPLACE FUNCTION public._season_instalment_plan(
  p_monthly_pence int, p_basis text, p_today date,
  p_season_start date, p_season_end date, p_period text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_interval interval := public._membership_period_interval(p_period);
  v_billing_start date;
  v_total int := 0;
  v_remaining int := 0;
  v_full int;
  v_prorated int;
  v_per int;
  v_d date;
BEGIN
  IF p_monthly_pence IS NULL OR p_season_start IS NULL OR p_season_end IS NULL
     OR p_season_end <= p_season_start OR v_interval IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_window');
  END IF;

  -- charge-dates across the whole season (season_start .. season_end inclusive)
  v_d := p_season_start;
  WHILE v_d <= p_season_end LOOP
    v_total := v_total + 1;
    v_d := v_d + v_interval;
  END LOOP;

  -- early joiner bills from the season start; mid-season joiner bills from today
  v_billing_start := GREATEST(p_today, p_season_start);

  -- remaining charge-dates from the billing start
  v_d := v_billing_start;
  WHILE v_d <= p_season_end LOOP
    v_remaining := v_remaining + 1;
    v_d := v_d + v_interval;
  END LOOP;

  IF v_total = 0 OR v_remaining = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_periods');
  END IF;

  v_full     := p_monthly_pence * v_total;
  v_prorated := public._prorated_first_charge(v_full, COALESCE(p_basis,'none'),
                                              p_today, p_season_start, p_season_end);

  v_per := floor(v_prorated::numeric / v_remaining);
  IF v_per < 0 THEN v_per := 0; END IF;

  RETURN jsonb_build_object(
    'ok',                   true,
    'per_period_pence',     v_per,
    'instalment_count',     v_remaining,
    'total_periods',        v_total,
    'billing_start',        v_billing_start,
    'prorated_total_pence', v_prorated,
    'full_season_pence',    v_full,
    'anchored',             (v_billing_start > p_today)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public._season_instalment_plan(int,text,date,date,date,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._season_instalment_plan(int,text,date,date,date,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._season_instalment_plan(int,text,date,date,date,text) TO service_role;

-- ── 4. stripe_record_season_payment — reconcile a paid season one-off into the ledger ─
-- A season checkout is mode='payment' (no subscription, no invoice), so neither mig-403
-- (subscription-keyed) nor mig-405 (invoice-keyed) can catch it. The webhook calls this right
-- after enrolment with the session's payment_intent so the captured money lands in the ledger
-- and shows in get_my_money(). Mints one idempotent charge + a 'stripe' payment; idempotent on
-- external_ref (the payment ref) so webhook replays are no-ops.
CREATE OR REPLACE FUNCTION public.stripe_record_season_payment(
  p_membership_id uuid, p_amount_pence int, p_charge_ref text, p_paid_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_m record; v_charge_id uuid; v_source_id text; v_extref text; v_exists boolean;
BEGIN
  IF p_membership_id IS NULL OR p_charge_ref IS NULL THEN
    RAISE EXCEPTION 'missing_params' USING ERRCODE='P0001';
  END IF;

  SELECT id, venue_id, amount_pence INTO v_m
    FROM public.venue_memberships WHERE id = p_membership_id;
  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_membership');
  END IF;

  v_source_id := v_m.id::text || ':season:' || p_charge_ref;
  v_extref    := p_charge_ref;

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
            v_extref, 'Stripe season payment ' || p_charge_ref, 'stripe_webhook');
    PERFORM public._recompute_charge_status(v_charge_id);

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_m.venue_id, NULL, 'system', 'stripe_webhook', 'membership_season_paid',
            'venue_charge', v_charge_id::text,
            jsonb_build_object('membership_id', v_m.id, 'charge_ref', v_extref,
                               'amount_pence', COALESCE(p_amount_pence, v_m.amount_pence)));
  END IF;

  RETURN jsonb_build_object('ok', true, 'charge_id', v_charge_id, 'recorded', NOT v_exists,
                            'charge_status', (SELECT status FROM public.venue_charges WHERE id=v_charge_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_record_season_payment(uuid,int,text,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_record_season_payment(uuid,int,text,timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_record_season_payment(uuid,int,text,timestamptz) TO service_role;

-- ── 5. stripe_set_membership_schedule — persist the schedule id + anchor on the membership ─
-- The webhook converts the Checkout subscription to a Subscription Schedule (so it auto-stops at
-- season end) AFTER enrolment, so the schedule id isn't known at enrolment time. This setter
-- writes it back (no direct client table writes — Hard Rule #2). Also stamps phase_end_at
-- (season end) + billing_starts_at (when the first instalment falls). service_role webhook-only.
CREATE OR REPLACE FUNCTION public.stripe_set_membership_schedule(
  p_membership_id uuid, p_schedule_id text, p_phase_end date, p_billing_start date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_m record;
BEGIN
  IF p_membership_id IS NULL THEN
    RAISE EXCEPTION 'missing_params' USING ERRCODE='P0001';
  END IF;

  UPDATE public.venue_memberships
     SET stripe_schedule_id = COALESCE(p_schedule_id, stripe_schedule_id),
         phase_end_at       = COALESCE(p_phase_end, phase_end_at),
         billing_starts_at  = COALESCE(p_billing_start, billing_starts_at),
         updated_at         = now()
   WHERE id = p_membership_id
  RETURNING id, venue_id INTO v_m;

  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_membership');
  END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_m.venue_id, NULL, 'system', 'stripe_webhook', 'membership_schedule_set',
          'venue_membership', v_m.id::text,
          jsonb_build_object('schedule_id', p_schedule_id, 'phase_end_at', p_phase_end,
                             'billing_starts_at', p_billing_start));

  RETURN jsonb_build_object('ok', true, 'membership_id', v_m.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_set_membership_schedule(uuid,text,date,date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_set_membership_schedule(uuid,text,date,date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_set_membership_schedule(uuid,text,date,date) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
