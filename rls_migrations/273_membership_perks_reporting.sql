-- 273_membership_perks_reporting.sql
--
-- Phase 6 — PARTNER PERKS (coalition loyalty) + MEMBERSHIP REPORTING.
--
-- Partner offers: a venue's partners (e.g. the pilot co-owner's pub) attach
-- offers ("show your pass for 10% off") that surface on the member pass and are
-- logged when used. Revenue here is sponsorship/affiliate — a SEPARATE pool from
-- the booking flow, so it stays inside the "we don't sit in the booking money"
-- rule. Offers can be all-member or tier-scoped.
--
-- Reporting: venue_membership_summary gives the dashboard active/paused/ending
-- counts, renewals-due, MRR (cadence-normalised), and 30-day churn.
--
-- Also extends get_member_pass (mig 272) to return the member's active offers.
--
-- DEFERRED (needs a booking↔member link that doesn't exist — bookings key on
-- team/walk-in, memberships on person): auto-applying tier discount_pct inside
-- venue_confirm_booking. Tracked for a later cycle.

-- ── 1. Tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_partners (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name       text NOT NULL,
  contact    text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_partners_by_venue ON public.venue_partners (venue_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.partner_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  partner_id  uuid NOT NULL REFERENCES public.venue_partners(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  code        text,                  -- shown to the member (e.g. "MEMBER10"); NULL = just show-your-pass
  tier_ids    uuid[],                -- NULL/empty = all members; else only these tiers
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_offers_by_venue ON public.partner_offers (venue_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.partner_redemptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id      uuid NOT NULL REFERENCES public.partner_offers(id) ON DELETE CASCADE,
  membership_id uuid REFERENCES public.venue_memberships(id) ON DELETE SET NULL,
  redeemed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_redemptions_by_offer ON public.partner_redemptions (offer_id);

ALTER TABLE public.venue_partners      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_offers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_partners, public.partner_offers, public.partner_redemptions FROM anon, authenticated;

-- ── 2. Ops RPCs (gated manage_memberships) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_partner(p_venue_token text, p_name text, p_contact text DEFAULT NULL)
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
  INSERT INTO public.venue_partners (venue_id, name, contact) VALUES (v_venue_id, v_name, NULLIF(btrim(p_contact),'')) RETURNING id INTO v_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_partner_created','venue_partner', v_id::text, jsonb_build_object('venue_id', v_venue_id, 'name', v_name));
  RETURN jsonb_build_object('ok', true, 'partner_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_create_partner(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_partner(text,text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.venue_create_offer(
  p_venue_token text, p_partner_id uuid, p_title text, p_description text DEFAULT NULL,
  p_code text DEFAULT NULL, p_tier_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_title text := NULLIF(btrim(p_title),''); v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_partners WHERE id=p_partner_id AND venue_id=v_venue_id) THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.partner_offers (venue_id, partner_id, title, description, code, tier_ids)
  VALUES (v_venue_id, p_partner_id, v_title, NULLIF(btrim(p_description),''), NULLIF(btrim(p_code),''),
          CASE WHEN p_tier_ids IS NULL OR array_length(p_tier_ids,1) IS NULL THEN NULL ELSE p_tier_ids END)
  RETURNING id INTO v_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_offer_created','partner_offer', v_id::text, jsonb_build_object('venue_id', v_venue_id, 'partner_id', p_partner_id, 'title', v_title));
  RETURN jsonb_build_object('ok', true, 'offer_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_create_offer(text,uuid,text,text,text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_offer(text,uuid,text,text,text,uuid[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.venue_set_offer_active(p_venue_token text, p_offer_id uuid, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  UPDATE public.partner_offers SET active = COALESCE(p_active,active) WHERE id=p_offer_id AND venue_id=v_venue_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('ok', true, 'offer_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_set_offer_active(text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_set_offer_active(text,uuid,boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.venue_list_partners(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'partner_id', p.id, 'name', p.name, 'contact', p.contact, 'active', p.active,
            'offers', COALESCE((SELECT jsonb_agg(jsonb_build_object('offer_id', o.id, 'title', o.title, 'description', o.description,
                                  'code', o.code, 'tier_ids', o.tier_ids, 'active', o.active,
                                  'redemptions', (SELECT count(*) FROM public.partner_redemptions r WHERE r.offer_id=o.id)) ORDER BY o.created_at)
                                  FROM public.partner_offers o WHERE o.partner_id=p.id), '[]'::jsonb)
          ) ORDER BY p.name), '[]'::jsonb)
    INTO v_rows FROM public.venue_partners p WHERE p.venue_id = v_venue_id;
  RETURN jsonb_build_object('ok', true, 'partners', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_partners(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_partners(text) TO anon, authenticated;

-- ── 3. Member-facing redeem (public, keyed by pass token) ────────────────────
CREATE OR REPLACE FUNCTION public.redeem_member_offer(p_pass_token text, p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_m record; v_o record;
BEGIN
  SELECT id, venue_id, tier_id, status INTO v_m FROM public.venue_memberships WHERE pass_token=p_pass_token AND status<>'cancelled';
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_pass'); END IF;
  SELECT o.id, o.title, o.code, o.tier_ids, o.active, o.venue_id INTO v_o FROM public.partner_offers o WHERE o.id=p_offer_id;
  IF v_o.id IS NULL OR NOT v_o.active OR v_o.venue_id <> v_m.venue_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_offer'); END IF;
  IF v_o.tier_ids IS NOT NULL AND array_length(v_o.tier_ids,1) IS NOT NULL AND NOT (v_m.tier_id = ANY(v_o.tier_ids)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_eligible'); END IF;
  INSERT INTO public.partner_redemptions (offer_id, membership_id) VALUES (v_o.id, v_m.id);
  RETURN jsonb_build_object('ok', true, 'title', v_o.title, 'code', v_o.code);
END; $fn$;
REVOKE ALL ON FUNCTION public.redeem_member_offer(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_member_offer(text,uuid) TO anon, authenticated;

-- ── 4. Reporting summary (read) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_membership_summary(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT jsonb_build_object(
    'active',   count(*) FILTER (WHERE status='active'),
    'paused',   count(*) FILTER (WHERE status='paused'),
    'ending',   count(*) FILTER (WHERE status='ending'),
    'due_soon', count(*) FILTER (WHERE status='active' AND renews_at <= current_date + 7),
    'mrr_pence', COALESCE(round(sum( (amount_pence::numeric) /
                   CASE period WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'annual' THEN 12 ELSE 1 END )
                   FILTER (WHERE status IN ('active','ending'))), 0),
    'cancelled_30d', count(*) FILTER (WHERE status='cancelled' AND cancel_at >= current_date - 30)
  ) INTO v FROM public.venue_memberships WHERE venue_id = v_venue_id;
  RETURN jsonb_build_object('ok', true, 'summary', COALESCE(v, '{}'::jsonb));
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_membership_summary(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_membership_summary(text) TO anon, authenticated;

-- ── 5. Extend get_member_pass — include the member's active offers ───────────
CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v jsonb; v_m record; v_offers jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT m.id, m.venue_id, m.tier_id INTO v_m FROM public.venue_memberships m WHERE m.pass_token=p_token AND m.status<>'cancelled';
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('offer_id', o.id, 'partner_name', pn.name,
            'title', o.title, 'description', o.description, 'code', o.code) ORDER BY o.created_at), '[]'::jsonb)
    INTO v_offers
    FROM public.partner_offers o JOIN public.venue_partners pn ON pn.id=o.partner_id
   WHERE o.venue_id = v_m.venue_id AND o.active AND pn.active
     AND (o.tier_ids IS NULL OR array_length(o.tier_ids,1) IS NULL OR v_m.tier_id = ANY(o.tier_ids));

  SELECT jsonb_build_object(
    'ok', true,
    'first_name', c.first_name, 'last_name', c.last_name,
    'tier_name', t.name, 'benefits', t.benefits,
    'period', m.period, 'amount_pence', m.amount_pence,
    'status', m.status, 'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until,
    'venue_name', vn.name, 'venue_logo', vn.logo_url,
    'primary_colour', vn.primary_colour, 'secondary_colour', vn.secondary_colour,
    'check_in_code', m.pass_token,
    'offers', v_offers
  ) INTO v
  FROM public.venue_memberships m
  JOIN public.venue_customers c        ON c.id = m.customer_id
  JOIN public.venue_membership_tiers t ON t.id = m.tier_id
  JOIN public.venues vn                ON vn.id = m.venue_id
  WHERE m.id = v_m.id;
  RETURN v;
END; $fn$;
REVOKE ALL ON FUNCTION public.get_member_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_pass(text) TO anon, authenticated;
