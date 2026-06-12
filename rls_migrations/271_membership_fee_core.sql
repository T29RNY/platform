-- 271_membership_fee_core.sql
--
-- Phase 3 of the Venue Membership programme — MEMBERSHIP & FEE CORE (manual billing).
-- The heart of the product, on the existing venue_charges ledger. Serves BOTH
-- pilot models:
--   • Fees (team/booker level)      → venue_fee_plans + venue_fee_subscriptions
--   • Membership (per-person)       → venue_membership_tiers + venue_tier_prices
--                                     + venue_memberships (with freeze)
--
-- Billing reuses venue_charges (source_type 'fee'/'membership' added below);
-- manual payment stays via the existing venue_record_payment. A unified
-- run_membership_renewals() (service_role, called by the cron) rolls every due
-- subscription/membership forward and mints the next charge — cloned in spirit
-- from create_renewal_holds. Charges encode the period in source_id so the
-- venue_charges uniqueness (source_type, source_id, COALESCE(team_id,'')) gives
-- one charge per cycle and makes the renewal idempotent.
--
-- All writes gated on manage_memberships (mig 269). Reads open to any venue
-- member. Audit on every write (Hard Rule #9).

-- ── 0. Extend the venue_charges source_type CHECK ────────────────────────────
ALTER TABLE public.venue_charges DROP CONSTRAINT IF EXISTS venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership']));

-- ── 1. period → interval helper ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._membership_period_interval(p_period text)
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_period
    WHEN 'weekly'    THEN interval '7 days'
    WHEN 'monthly'   THEN interval '1 month'
    WHEN 'quarterly' THEN interval '3 months'
    WHEN 'annual'    THEN interval '1 year'
  END;
$$;

-- ── 2. Tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_membership_tiers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name       text NOT NULL,
  benefits   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {discount_pct,included_sessions,priority_booking,equipment_included,sports_included[]}
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_membership_tiers_by_venue ON public.venue_membership_tiers (venue_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.venue_tier_prices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id     uuid NOT NULL REFERENCES public.venue_membership_tiers(id) ON DELETE CASCADE,
  period      text NOT NULL CHECK (period IN ('monthly','quarterly','annual')),
  price_pence int  NOT NULL CHECK (price_pence >= 0),
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (tier_id, period)
);

CREATE TABLE IF NOT EXISTS public.venue_memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES public.venue_customers(id) ON DELETE CASCADE,
  tier_id      uuid NOT NULL REFERENCES public.venue_membership_tiers(id),
  period       text NOT NULL CHECK (period IN ('monthly','quarterly','annual')),
  amount_pence int  NOT NULL CHECK (amount_pence >= 0),     -- snapshot at enrol (fair rate hold)
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ending','cancelled')),
  started_at   date NOT NULL DEFAULT current_date,
  renews_at    date NOT NULL,                               -- next charge date
  frozen_until date,                                        -- set while status='paused'
  cancel_at    date,                                        -- end-of-period cancel target
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_memberships_by_venue    ON public.venue_memberships (venue_id);
CREATE INDEX IF NOT EXISTS venue_memberships_by_customer ON public.venue_memberships (customer_id);
CREATE INDEX IF NOT EXISTS venue_memberships_due         ON public.venue_memberships (renews_at) WHERE status = 'active';
-- one LIVE membership per person (a person can re-enrol after cancelling)
CREATE UNIQUE INDEX IF NOT EXISTS venue_memberships_one_live
  ON public.venue_memberships (customer_id) WHERE status IN ('active','paused','ending');

CREATE TABLE IF NOT EXISTS public.venue_fee_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name         text NOT NULL,
  amount_pence int  NOT NULL CHECK (amount_pence >= 0),
  period       text NOT NULL CHECK (period IN ('weekly','monthly','quarterly','annual')),
  sport        text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_fee_plans_by_venue ON public.venue_fee_plans (venue_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.venue_fee_subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  plan_id        uuid NOT NULL REFERENCES public.venue_fee_plans(id),
  member_key     text NOT NULL,                              -- team_id OR booked_by_name (pitch_bookings booker model)
  team_id        text REFERENCES public.teams(id) ON DELETE SET NULL,  -- set when booker is a team (→ venue_charges.team_id)
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  started_at     date NOT NULL DEFAULT current_date,
  next_charge_at date NOT NULL,
  cancel_at      date,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_fee_subs_due ON public.venue_fee_subscriptions (next_charge_at) WHERE status = 'active';

-- RLS: all RPC-only (venue posture)
ALTER TABLE public.venue_membership_tiers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_tier_prices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_memberships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_fee_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_fee_subscriptions  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_membership_tiers, public.venue_tier_prices, public.venue_memberships,
              public.venue_fee_plans, public.venue_fee_subscriptions FROM anon, authenticated;

-- ── 3. Tier RPCs ─────────────────────────────────────────────────────────────
-- create tier + its per-cadence prices in one call.
-- p_prices = jsonb array [{"period":"monthly","price_pence":3000}, ...]
CREATE OR REPLACE FUNCTION public.venue_create_membership_tier(
  p_venue_token text, p_name text, p_benefits jsonb DEFAULT '{}'::jsonb, p_prices jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record; v_venue_id text; v_name text := NULLIF(btrim(p_name),''); v_tier uuid; v_pr jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.venue_membership_tiers (venue_id, name, benefits)
  VALUES (v_venue_id, v_name, COALESCE(p_benefits,'{}'::jsonb)) RETURNING id INTO v_tier;

  FOR v_pr IN SELECT * FROM jsonb_array_elements(COALESCE(p_prices,'[]'::jsonb)) LOOP
    IF (v_pr->>'period') NOT IN ('monthly','quarterly','annual') THEN
      RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001', DETAIL = (v_pr->>'period'); END IF;
    INSERT INTO public.venue_tier_prices (tier_id, period, price_pence)
    VALUES (v_tier, v_pr->>'period', (v_pr->>'price_pence')::int);
  END LOOP;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_tier_created','venue_membership_tier', v_tier::text,
          jsonb_build_object('venue_id', v_venue_id, 'name', v_name, 'prices', COALESCE(p_prices,'[]'::jsonb)));
  RETURN jsonb_build_object('ok', true, 'tier_id', v_tier);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_create_membership_tier(text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_membership_tier(text,text,jsonb,jsonb) TO anon, authenticated;

-- update tier name/benefits/active; if p_prices given, upsert each cadence.
CREATE OR REPLACE FUNCTION public.venue_update_membership_tier(
  p_venue_token text, p_tier_id uuid, p_name text DEFAULT NULL, p_benefits jsonb DEFAULT NULL,
  p_active boolean DEFAULT NULL, p_prices jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_id uuid; v_pr jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;

  UPDATE public.venue_membership_tiers SET
    name = COALESCE(NULLIF(btrim(p_name),''), name),
    benefits = COALESCE(p_benefits, benefits),
    active = COALESCE(p_active, active),
    updated_at = now()
  WHERE id = p_tier_id AND venue_id = v_venue_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;

  IF p_prices IS NOT NULL THEN
    FOR v_pr IN SELECT * FROM jsonb_array_elements(p_prices) LOOP
      IF (v_pr->>'period') NOT IN ('monthly','quarterly','annual') THEN
        RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001', DETAIL=(v_pr->>'period'); END IF;
      INSERT INTO public.venue_tier_prices (tier_id, period, price_pence)
      VALUES (v_id, v_pr->>'period', (v_pr->>'price_pence')::int)
      ON CONFLICT (tier_id, period) DO UPDATE SET price_pence = EXCLUDED.price_pence, active = true;
    END LOOP;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_tier_updated','venue_membership_tier', v_id::text, jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'tier_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_membership_tier(text,uuid,text,jsonb,boolean,jsonb) TO anon, authenticated;

-- ── 4. Enrol / freeze / cancel ───────────────────────────────────────────────
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

  -- customer + tier must belong to this venue; price must exist for the cadence
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

  -- first period charge (idempotent on source_id = membership:period_start)
  INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  VALUES (v_venue_id, 'membership', v_mid::text || ':' || current_date::text, NULL, NULL, v_price, 'unpaid', current_date)
  ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_enrolled','venue_membership', v_mid::text,
          jsonb_build_object('venue_id', v_venue_id, 'tier_id', p_tier_id, 'period', p_period, 'amount_pence', v_price));
  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid, 'amount_pence', v_price, 'renews_at', v_renews);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_enrol_membership(text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_enrol_membership(text,uuid,uuid,text) TO anon, authenticated;

-- Freeze: pause (no charge while paused), extend renews_at by the freeze length so
-- the frozen window is never billed. Reactivation is automatic in the renewal cron
-- when frozen_until passes.
CREATE OR REPLACE FUNCTION public.venue_freeze_membership(
  p_venue_token text, p_membership_id uuid, p_until date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_id uuid; v_days int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF p_until IS NULL OR p_until <= current_date THEN RAISE EXCEPTION 'invalid_freeze_until' USING ERRCODE='P0001'; END IF;
  v_days := p_until - current_date;

  UPDATE public.venue_memberships SET
    status='paused', frozen_until=p_until, renews_at = renews_at + (v_days || ' days')::interval, updated_at=now()
  WHERE id=p_membership_id AND venue_id=v_venue_id AND status='active' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'membership_not_active' USING ERRCODE='P0001'; END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_frozen','venue_membership', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'frozen_until', p_until, 'days', v_days));
  RETURN jsonb_build_object('ok', true, 'membership_id', v_id, 'frozen_until', p_until);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_freeze_membership(text,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_freeze_membership(text,uuid,date) TO anon, authenticated;

-- Cancel: immediate (status=cancelled now) or end-of-period (status=ending; the
-- renewal cron flips ending→cancelled at renews_at, minting NO further charge).
CREATE OR REPLACE FUNCTION public.venue_cancel_membership(
  p_venue_token text, p_membership_id uuid, p_immediate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_id uuid; v_status text; v_renews date;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;

  IF p_immediate THEN
    UPDATE public.venue_memberships SET status='cancelled', cancel_at=current_date, updated_at=now()
    WHERE id=p_membership_id AND venue_id=v_venue_id AND status IN ('active','paused','ending')
    RETURNING id, status, renews_at INTO v_id, v_status, v_renews;
  ELSE
    UPDATE public.venue_memberships SET status='ending', cancel_at=renews_at, updated_at=now()
    WHERE id=p_membership_id AND venue_id=v_venue_id AND status IN ('active','paused')
    RETURNING id, status, renews_at INTO v_id, v_status, v_renews;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'membership_not_cancellable' USING ERRCODE='P0001'; END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_cancelled','venue_membership', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'immediate', p_immediate, 'cancel_at', COALESCE(current_date, v_renews)));
  RETURN jsonb_build_object('ok', true, 'membership_id', v_id, 'status', v_status);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_membership(text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_membership(text,uuid,boolean) TO anon, authenticated;

-- ── 5. Fee plans + subscriptions ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_fee_plan(
  p_venue_token text, p_name text, p_amount_pence int, p_period text, p_sport text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_name text := NULLIF(btrim(p_name),''); v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  IF p_period NOT IN ('weekly','monthly','quarterly','annual') THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001'; END IF;
  IF p_amount_pence IS NULL OR p_amount_pence < 0 THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.venue_fee_plans (venue_id, name, amount_pence, period, sport)
  VALUES (v_venue_id, v_name, p_amount_pence, p_period, NULLIF(btrim(p_sport),'')) RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_fee_plan_created','venue_fee_plan', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'amount_pence', p_amount_pence, 'period', p_period));
  RETURN jsonb_build_object('ok', true, 'plan_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_create_fee_plan(text,text,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_fee_plan(text,text,int,text,text) TO anon, authenticated;

-- Enrol a booker on a fee plan. Mints the first charge now.
CREATE OR REPLACE FUNCTION public.venue_enrol_fee(
  p_venue_token text, p_plan_id uuid, p_member_key text, p_team_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_amount int; v_period text; v_key text := NULLIF(btrim(p_member_key),''); v_next date; v_sid uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'member_key_required' USING ERRCODE='P0001'; END IF;

  SELECT amount_pence, period INTO v_amount, v_period FROM public.venue_fee_plans
   WHERE id=p_plan_id AND venue_id=v_venue_id AND active;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'plan_not_found' USING ERRCODE='P0001'; END IF;
  IF p_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams WHERE id=p_team_id) THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001'; END IF;

  v_next := current_date + public._membership_period_interval(v_period);

  INSERT INTO public.venue_fee_subscriptions (venue_id, plan_id, member_key, team_id, status, started_at, next_charge_at)
  VALUES (v_venue_id, p_plan_id, v_key, p_team_id, 'active', current_date, v_next) RETURNING id INTO v_sid;

  INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  VALUES (v_venue_id, 'fee', v_sid::text || ':' || current_date::text, p_team_id, NULL, v_amount, 'unpaid', current_date)
  ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_fee_enrolled','venue_fee_subscription', v_sid::text,
          jsonb_build_object('venue_id', v_venue_id, 'plan_id', p_plan_id, 'member_key', v_key, 'amount_pence', v_amount));
  RETURN jsonb_build_object('ok', true, 'subscription_id', v_sid, 'amount_pence', v_amount, 'next_charge_at', v_next);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_enrol_fee(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_enrol_fee(text,uuid,text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.venue_cancel_fee(p_venue_token text, p_subscription_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  UPDATE public.venue_fee_subscriptions SET status='cancelled', cancel_at=current_date
   WHERE id=p_subscription_id AND venue_id=v_venue_id AND status='active' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'subscription_not_active' USING ERRCODE='P0001'; END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_fee_cancelled','venue_fee_subscription', v_id::text, jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'subscription_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_fee(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_fee(text,uuid) TO anon, authenticated;

-- ── 6. Reads ─────────────────────────────────────────────────────────────────
-- members roster: membership + customer + tier, with a renewals-due flag.
CREATE OR REPLACE FUNCTION public.venue_list_members(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'membership_id', m.id, 'status', m.status, 'period', m.period, 'amount_pence', m.amount_pence,
            'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until, 'cancel_at', m.cancel_at,
            'due_soon', (m.status='active' AND m.renews_at <= current_date + 7),
            'customer_id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email,
            'tier_id', t.id, 'tier_name', t.name
          ) ORDER BY m.status, c.first_name), '[]'::jsonb)
    INTO v_rows
    FROM public.venue_memberships m
    JOIN public.venue_customers c ON c.id = m.customer_id
    JOIN public.venue_membership_tiers t ON t.id = m.tier_id
   WHERE m.venue_id = v_venue_id AND m.status <> 'cancelled';
  RETURN jsonb_build_object('ok', true, 'members', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_members(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_members(text) TO anon, authenticated;

-- tiers (+ prices) for config
CREATE OR REPLACE FUNCTION public.venue_list_membership_tiers(p_venue_token text, p_include_inactive boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'tier_id', t.id, 'name', t.name, 'benefits', t.benefits, 'active', t.active,
            'prices', COALESCE((SELECT jsonb_agg(jsonb_build_object('period', p.period, 'price_pence', p.price_pence) ORDER BY p.price_pence)
                                  FROM public.venue_tier_prices p WHERE p.tier_id=t.id AND p.active), '[]'::jsonb)
          ) ORDER BY t.name), '[]'::jsonb)
    INTO v_rows
    FROM public.venue_membership_tiers t
   WHERE t.venue_id = v_venue_id AND (p_include_inactive OR t.active);
  RETURN jsonb_build_object('ok', true, 'tiers', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_membership_tiers(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_membership_tiers(text,boolean) TO anon, authenticated;

-- fee plans + their active subscriptions
CREATE OR REPLACE FUNCTION public.venue_list_fee_plans(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'plan_id', fp.id, 'name', fp.name, 'amount_pence', fp.amount_pence, 'period', fp.period,
            'sport', fp.sport, 'active', fp.active,
            'subscriptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('subscription_id', s.id, 'member_key', s.member_key,
                                          'team_id', s.team_id, 'status', s.status, 'next_charge_at', s.next_charge_at)
                                          ORDER BY s.created_at) FROM public.venue_fee_subscriptions s
                                          WHERE s.plan_id=fp.id AND s.status='active'), '[]'::jsonb)
          ) ORDER BY fp.name), '[]'::jsonb)
    INTO v_rows
    FROM public.venue_fee_plans fp
   WHERE fp.venue_id = v_venue_id;
  RETURN jsonb_build_object('ok', true, 'fee_plans', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_fee_plans(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_fee_plans(text) TO anon, authenticated;

-- ── 7. Renewal engine (service_role; called by the cron) ─────────────────────
-- One pass: reactivate freezes whose window passed, flip ending→cancelled at term,
-- mint the next charge for due active memberships + fee subscriptions, advance dates.
-- Idempotent: charges ON CONFLICT DO NOTHING on (source_type, source_id incl. period).
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

  -- (b) ending memberships reaching term → cancelled (no further charge)
  UPDATE public.venue_memberships
     SET status='cancelled', updated_at=now()
   WHERE status='ending' AND renews_at <= current_date;
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  -- (c) due active memberships → mint next charge, advance renews_at
  FOR v_m IN
    SELECT id, venue_id, amount_pence, period, renews_at
      FROM public.venue_memberships
     WHERE status='active' AND renews_at <= current_date
     FOR UPDATE
  LOOP
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_m.venue_id, 'membership', v_m.id::text || ':' || v_m.renews_at::text, NULL, NULL, v_m.amount_pence, 'unpaid', v_m.renews_at)
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
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_s.venue_id, 'fee', v_s.id::text || ':' || v_s.next_charge_at::text, v_s.team_id, NULL, v_s.amount_pence, 'unpaid', v_s.next_charge_at)
    ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;
    UPDATE public.venue_fee_subscriptions
       SET next_charge_at = next_charge_at + public._membership_period_interval(v_s.period)
     WHERE id = v_s.id;
    v_minted := v_minted + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'minted', v_minted, 'reactivated', v_reactivated, 'ended', v_ended);
END; $fn$;
REVOKE ALL ON FUNCTION public.run_membership_renewals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_membership_renewals() TO service_role;
