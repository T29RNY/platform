-- 280_tiered_self_signup.sql
--
-- Membership self-signup, tier-aware (operator decisions 2026-06-13):
--   • Tiers are venue-defined; each can be FREE or PAID, and can be offered on the
--     /q signup page or not. Stored on the tier's existing `benefits` jsonb as
--     `is_free` (bool) + `self_signup` (bool) — no new tier columns, no RPC churn.
--   • At /q the prospect PICKS a tier (get_venue_signup_tiers lists the offered ones).
--   • FREE tier  → AUTO-APPROVED: an active person + an active £0 membership (pass
--     issued immediately, no charge, never renews-bills).
--   • PAID tier  → a PENDING request tagged with the chosen tier; the venue completes
--     it with venue_approve_and_enrol (one tap → active person + membership + first
--     charge). They become a paying member once that charge is settled (manual now,
--     Stripe later — see DECISIONS money-flow gate).
-- A venue that wants only paid tiers simply marks none of its tiers `is_free`.

-- 1. Which paid tier a pending self-signup asked for.
ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS requested_tier_id uuid REFERENCES public.venue_membership_tiers(id) ON DELETE SET NULL;

-- 2. get_venue_signup_tiers(code) — PUBLIC. The tier menu for the /q page: the
--    venue's active tiers flagged `self_signup`, with free/paid + pricing.
CREATE OR REPLACE FUNCTION public.get_venue_signup_tiers(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_link record; v_venue_id text; v_rows jsonb;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  SELECT entity_id, entity_type, action, active INTO v_link FROM public.invite_links WHERE code = btrim(p_code);
  IF NOT FOUND OR v_link.entity_type <> 'venue' OR v_link.action <> 'venue_landing' OR NOT v_link.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  v_venue_id := v_link.entity_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'tier_id', t.id, 'name', t.name, 'benefits', t.benefits,
            'is_free', COALESCE((t.benefits->>'is_free')::boolean, false),
            'prices', COALESCE((SELECT jsonb_agg(jsonb_build_object('period', p.period, 'price_pence', p.price_pence) ORDER BY p.price_pence)
                                  FROM public.venue_tier_prices p WHERE p.tier_id=t.id AND p.active), '[]'::jsonb)
          ) ORDER BY COALESCE((t.benefits->>'is_free')::boolean, false) DESC, t.name), '[]'::jsonb)
    INTO v_rows
    FROM public.venue_membership_tiers t
   WHERE t.venue_id = v_venue_id AND t.active
     AND COALESCE((t.benefits->>'self_signup')::boolean, false) = true;

  RETURN jsonb_build_object('ok', true, 'tiers', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.get_venue_signup_tiers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_venue_signup_tiers(text) TO anon, authenticated;

-- 3. member_self_signup gains p_tier_id. DROP the old 6-arg signature first (a new
--    arg-count is a new overload; avoid "could not choose best candidate").
DROP FUNCTION IF EXISTS public.member_self_signup(text,text,text,text,text,boolean);
CREATE OR REPLACE FUNCTION public.member_self_signup(
  p_code              text,
  p_first_name        text,
  p_last_name         text DEFAULT NULL,
  p_email             text DEFAULT NULL,
  p_phone             text DEFAULT NULL,
  p_consent_marketing boolean DEFAULT false,
  p_tier_id           uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_link     record;
  v_venue_id text;
  v_first    text := NULLIF(btrim(p_first_name), '');
  v_email    text := NULLIF(lower(btrim(p_email)), '');
  v_phone    text := NULLIF(btrim(p_phone), '');
  v_existing record;
  v_tier     record;
  v_cid      uuid;
  v_mid      uuid;
  v_pass     text;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;

  SELECT entity_id, entity_type, action, active, expires_at, max_uses, use_count
    INTO v_link FROM public.invite_links WHERE code = btrim(p_code);
  IF NOT FOUND OR v_link.entity_type <> 'venue' OR v_link.action <> 'venue_landing' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF NOT v_link.active
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at < now())
     OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  v_venue_id := v_link.entity_id;

  IF v_first IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'first_name_required'); END IF;

  -- validate the chosen tier (if any) belongs to the venue + is offered on signup
  IF p_tier_id IS NOT NULL THEN
    SELECT id, COALESCE((benefits->>'is_free')::boolean, false) AS is_free,
           COALESCE((benefits->>'self_signup')::boolean, false) AS self_signup
      INTO v_tier
      FROM public.venue_membership_tiers
     WHERE id = p_tier_id AND venue_id = v_venue_id AND active;
    IF NOT FOUND OR NOT v_tier.self_signup THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'tier_unavailable');
    END IF;
  END IF;

  -- idempotent on email: an existing non-erased person is returned, not duplicated
  IF v_email IS NOT NULL THEN
    SELECT id, status INTO v_existing FROM public.venue_customers
     WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased' LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'already_registered', true, 'status', v_existing.status);
    END IF;
  END IF;

  UPDATE public.invite_links SET use_count = use_count + 1 WHERE code = btrim(p_code);

  -- FREE tier → auto-approved member (active person + active £0 membership + pass)
  IF p_tier_id IS NOT NULL AND v_tier.is_free THEN
    INSERT INTO public.venue_customers (venue_id, first_name, last_name, email, phone, status, consent_marketing, consent_at)
    VALUES (v_venue_id, v_first, NULLIF(btrim(p_last_name),''), v_email, v_phone, 'active',
            COALESCE(p_consent_marketing,false), CASE WHEN COALESCE(p_consent_marketing,false) THEN now() ELSE NULL END)
    RETURNING id INTO v_cid;

    INSERT INTO public.venue_memberships (venue_id, customer_id, tier_id, period, amount_pence, status, started_at, renews_at)
    VALUES (v_venue_id, v_cid, p_tier_id, 'monthly', 0, 'active', current_date, DATE '2999-01-01')
    RETURNING id, pass_token INTO v_mid, v_pass;

    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), 'system', 'self_signup:'||btrim(p_code), 'venue_customer_self_signup', 'venue_customer', v_cid::text,
            jsonb_build_object('venue_id', v_venue_id, 'via', 'qr_venue_landing', 'tier_id', p_tier_id, 'free', true, 'auto_approved', true));
    PERFORM public.notify_venue_change(v_venue_id, 'customer_self_signup');
    RETURN jsonb_build_object('ok', true, 'already_registered', false, 'free', true, 'status', 'active', 'pass_token', v_pass);
  END IF;

  -- PAID (or tier-less) → pending request, tagged with the chosen tier
  INSERT INTO public.venue_customers (venue_id, first_name, last_name, email, phone, status, requested_tier_id, consent_marketing, consent_at)
  VALUES (v_venue_id, v_first, NULLIF(btrim(p_last_name),''), v_email, v_phone, 'pending', p_tier_id,
          COALESCE(p_consent_marketing,false), CASE WHEN COALESCE(p_consent_marketing,false) THEN now() ELSE NULL END)
  RETURNING id INTO v_cid;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), 'system', 'self_signup:'||btrim(p_code), 'venue_customer_self_signup', 'venue_customer', v_cid::text,
          jsonb_build_object('venue_id', v_venue_id, 'via', 'qr_venue_landing', 'tier_id', p_tier_id, 'free', false));
  PERFORM public.notify_venue_change(v_venue_id, 'customer_self_signup');
  RETURN jsonb_build_object('ok', true, 'already_registered', false, 'free', false, 'status', 'pending');
END; $fn$;
REVOKE ALL ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean,uuid) TO anon, authenticated;

-- 4. venue_approve_and_enrol — one tap: activate the pending person + enrol them on
--    a tier (membership + first charge). Gated manage_memberships. For paid tiers
--    the charge is the amount owed; the member is paid-up once it's settled.
CREATE OR REPLACE FUNCTION public.venue_approve_and_enrol(
  p_venue_token text, p_customer_id uuid, p_tier_id uuid, p_period text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record; v_venue_id text; v_price int; v_is_free boolean; v_mid uuid; v_renews date; v_status text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF p_period NOT IN ('monthly','quarterly','annual') THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001'; END IF;

  SELECT status INTO v_status FROM public.venue_customers WHERE id=p_customer_id AND venue_id=v_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0001'; END IF;
  IF v_status = 'erased' THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0001'; END IF;

  SELECT COALESCE((benefits->>'is_free')::boolean, false) INTO v_is_free
    FROM public.venue_membership_tiers WHERE id=p_tier_id AND venue_id=v_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;

  IF v_is_free THEN
    v_price := 0;
    v_renews := DATE '2999-01-01';
  ELSE
    SELECT price_pence INTO v_price FROM public.venue_tier_prices WHERE tier_id=p_tier_id AND period=p_period AND active;
    IF v_price IS NULL THEN RAISE EXCEPTION 'price_not_set' USING ERRCODE='P0001'; END IF;
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  -- activate the person + clear the request tag
  UPDATE public.venue_customers SET status='active', requested_tier_id=NULL, updated_at=now()
   WHERE id=p_customer_id AND venue_id=v_venue_id;

  BEGIN
    INSERT INTO public.venue_memberships (venue_id, customer_id, tier_id, period, amount_pence, status, started_at, renews_at)
    VALUES (v_venue_id, p_customer_id, p_tier_id, p_period, v_price, 'active', current_date, v_renews)
    RETURNING id INTO v_mid;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE='P0001';
  END;

  IF v_price > 0 THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_venue_id, 'membership', v_mid::text || ':' || current_date::text, NULL, NULL, v_price, 'unpaid', current_date)
    ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_enrolled','venue_membership', v_mid::text,
          jsonb_build_object('venue_id', v_venue_id, 'tier_id', p_tier_id, 'period', p_period, 'amount_pence', v_price, 'via', 'approve_and_enrol'));
  PERFORM public.notify_venue_change(v_venue_id, 'customer_approved');

  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid, 'amount_pence', v_price, 'renews_at', v_renews);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_approve_and_enrol(text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_approve_and_enrol(text,uuid,uuid,text) TO anon, authenticated;

-- 5. venue_list_customers_people — surface the requested tier so the request panel
--    can show "wants Gold" + pre-fill approve-and-enrol.
CREATE OR REPLACE FUNCTION public.venue_list_customers_people(
  p_venue_token   text,
  p_include_erased boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.first_name, c.last_name), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT vc.id, vc.venue_id, vc.first_name, vc.last_name, vc.email, vc.phone, vc.dob, vc.household_id,
             vc.status, vc.consent_marketing, vc.consent_at, vc.created_at, vc.updated_at,
             vc.requested_tier_id, t.name AS requested_tier_name
        FROM public.venue_customers vc
        LEFT JOIN public.venue_membership_tiers t ON t.id = vc.requested_tier_id
       WHERE vc.venue_id = v_venue_id
         AND (p_include_erased OR vc.status <> 'erased')
    ) c;
  RETURN jsonb_build_object('ok', true, 'customers', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_customers_people(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_customers_people(text,boolean) TO anon, authenticated;
