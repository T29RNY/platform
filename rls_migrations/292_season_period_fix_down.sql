-- 292_season_period_fix_down.sql
-- Reverts season period support. Do not run while any season memberships exist.

ALTER TABLE public.venue_memberships
  DROP CONSTRAINT IF EXISTS venue_memberships_period_check;
ALTER TABLE public.venue_memberships
  ADD CONSTRAINT venue_memberships_period_check
    CHECK (period IN ('monthly','quarterly','annual'));

CREATE OR REPLACE FUNCTION public.venue_enrol_membership(
  p_venue_token text, p_customer_id uuid, p_tier_id uuid, p_period text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record; v_venue_id text; v_price int; v_mid uuid; v_renews date := current_date;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF p_period NOT IN ('monthly','quarterly','annual') THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_customers WHERE id=p_customer_id AND venue_id=v_venue_id AND status<>'erased') THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_membership_tiers WHERE id=p_tier_id AND venue_id=v_venue_id) THEN
    RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;
  SELECT price_pence INTO v_price FROM public.venue_tier_prices WHERE tier_id=p_tier_id AND period=p_period AND active;
  IF v_price IS NULL THEN RAISE EXCEPTION 'price_not_set' USING ERRCODE='P0001'; END IF;
  v_renews := current_date + public._membership_period_interval(p_period);
  BEGIN
    INSERT INTO public.venue_memberships (venue_id, customer_id, tier_id, period, amount_pence, status, started_at, renews_at)
    VALUES (v_venue_id, p_customer_id, p_tier_id, p_period, v_price, 'active', current_date, v_renews)
    RETURNING id INTO v_mid;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE='P0001';
  END;
  INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  VALUES (v_venue_id, 'membership', v_mid::text || ':' || current_date::text, NULL, NULL, v_price, 'unpaid', current_date)
  ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_enrolled','venue_membership', v_mid::text,
          jsonb_build_object('venue_id', v_venue_id, 'tier_id', p_tier_id, 'period', p_period, 'amount_pence', v_price));
  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid, 'amount_pence', v_price, 'renews_at', v_renews);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_enrol_membership(text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_enrol_membership(text,uuid,uuid,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_membership_renewals()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_m record; v_s record; v_minted int := 0; v_reactivated int := 0; v_ended int := 0;
BEGIN
  UPDATE public.venue_memberships SET status='active', frozen_until=NULL, updated_at=now()
   WHERE status='paused' AND frozen_until IS NOT NULL AND frozen_until <= current_date;
  GET DIAGNOSTICS v_reactivated = ROW_COUNT;
  UPDATE public.venue_memberships SET status='cancelled', updated_at=now()
   WHERE status='ending' AND renews_at <= current_date;
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  FOR v_m IN SELECT id, venue_id, amount_pence, period, renews_at FROM public.venue_memberships
              WHERE status='active' AND renews_at <= current_date FOR UPDATE LOOP
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_m.venue_id, 'membership', v_m.id::text || ':' || v_m.renews_at::text, NULL, NULL, v_m.amount_pence, 'unpaid', v_m.renews_at)
    ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;
    UPDATE public.venue_memberships SET renews_at = renews_at + public._membership_period_interval(period), updated_at=now() WHERE id = v_m.id;
    v_minted := v_minted + 1;
  END LOOP;
  FOR v_s IN SELECT s.id, s.venue_id, s.team_id, s.next_charge_at, fp.amount_pence, fp.period
               FROM public.venue_fee_subscriptions s JOIN public.venue_fee_plans fp ON fp.id = s.plan_id
              WHERE s.status='active' AND s.next_charge_at <= current_date FOR UPDATE OF s LOOP
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_s.venue_id, 'fee', v_s.id::text || ':' || v_s.next_charge_at::text, v_s.team_id, NULL, v_s.amount_pence, 'unpaid', v_s.next_charge_at)
    ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;
    UPDATE public.venue_fee_subscriptions SET next_charge_at = next_charge_at + public._membership_period_interval(v_s.period) WHERE id = v_s.id;
    v_minted := v_minted + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'minted', v_minted, 'reactivated', v_reactivated, 'ended', v_ended);
END;
$fn$;
REVOKE ALL ON FUNCTION public.run_membership_renewals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_membership_renewals() TO service_role;
