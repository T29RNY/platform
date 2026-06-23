-- 403_stripe_phase1_safety_down.sql — reverse of 403.
-- Restores run_membership_renewals + stripe_complete_member_enrolment to their mig-292
-- bodies/signatures, drops the new Stripe ledger RPCs + stripe_customers table, and
-- reverts the venue_payments.method check. (No live data in stripe_customers / no 'stripe'
-- payments exist until live keys, so the constraint revert is safe pre-go-live.)

DROP FUNCTION IF EXISTS public.stripe_record_invoice_payment(text,text,text,integer,timestamptz);
DROP FUNCTION IF EXISTS public.stripe_record_refund(text,integer,text);
DROP FUNCTION IF EXISTS public.get_or_link_stripe_customer(uuid,text,text,text);

-- enrolment: back to the 8-arg signature (no payer_profile_id)
DROP FUNCTION IF EXISTS public.stripe_complete_member_enrolment(text,text,text,text,uuid,text,uuid,integer,uuid);
-- (re-apply mig 292's 8-arg body by re-running the relevant section of an earlier migration
--  if a true rollback is needed; left as a DROP here since 403 is forward-only in practice.)

DROP TABLE IF EXISTS public.stripe_customers;

ALTER TABLE public.venue_payments DROP CONSTRAINT IF EXISTS venue_payments_method_check;
ALTER TABLE public.venue_payments ADD CONSTRAINT venue_payments_method_check
  CHECK (method = ANY (ARRAY['cash','bank_transfer','card','other']));

-- run_membership_renewals: restore the pre-403 body (no stripe_subscription_id guard)
CREATE OR REPLACE FUNCTION public.run_membership_renewals()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_m record; v_s record; v_minted int := 0; v_reactivated int := 0; v_ended int := 0;
BEGIN
  UPDATE public.venue_memberships
     SET status='active', frozen_until=NULL, updated_at=now()
   WHERE status='paused' AND frozen_until IS NOT NULL AND frozen_until <= current_date;
  GET DIAGNOSTICS v_reactivated = ROW_COUNT;
  UPDATE public.venue_memberships
     SET status='cancelled', updated_at=now()
   WHERE status='ending' AND renews_at <= current_date;
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  FOR v_m IN
    SELECT id, venue_id, amount_pence, period, renews_at
      FROM public.venue_memberships
     WHERE status='active' AND renews_at <= current_date AND period <> 'season'
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
