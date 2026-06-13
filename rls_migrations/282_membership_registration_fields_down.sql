-- 282_membership_registration_fields_down.sql
-- Reverts mig 282: drop the widened RPC overloads, restore the prior signatures
-- (from migs 270/280), then drop the new columns.

DROP FUNCTION IF EXISTS public.venue_create_customer(text,text,text,text,text,date,uuid,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean);
DROP FUNCTION IF EXISTS public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean);
DROP FUNCTION IF EXISTS public.member_self_signup(text,text,text,text,text,boolean,uuid,date,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean);

-- restore prior venue_create_customer (mig 270)
CREATE OR REPLACE FUNCTION public.venue_create_customer(
  p_venue_token text, p_first_name text, p_last_name text DEFAULT NULL, p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_dob date DEFAULT NULL, p_household_id uuid DEFAULT NULL, p_consent_marketing boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_first text := NULLIF(btrim(p_first_name), '');
  v_email text := NULLIF(lower(btrim(p_email)), ''); v_phone text := NULLIF(btrim(p_phone), ''); v_existing uuid; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF v_first IS NULL THEN RAISE EXCEPTION 'first_name_required' USING ERRCODE = 'P0001'; END IF;
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.venue_customers WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased' LIMIT 1;
    IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'customer_exists' USING ERRCODE = 'P0001', DETAIL = v_existing::text; END IF;
  END IF;
  INSERT INTO public.venue_customers (venue_id, first_name, last_name, email, phone, dob, household_id, consent_marketing, consent_at)
  VALUES (v_venue_id, v_first, NULLIF(btrim(p_last_name), ''), v_email, v_phone, p_dob, p_household_id,
          COALESCE(p_consent_marketing, false), CASE WHEN COALESCE(p_consent_marketing, false) THEN now() ELSE NULL END)
  RETURNING id INTO v_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_customer_created', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'has_email', v_email IS NOT NULL, 'has_phone', v_phone IS NOT NULL, 'consent_marketing', COALESCE(p_consent_marketing, false)));
  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_create_customer(text,text,text,text,text,date,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_customer(text,text,text,text,text,date,uuid,boolean) TO anon, authenticated;

-- restore prior venue_update_customer (mig 270)
CREATE OR REPLACE FUNCTION public.venue_update_customer(
  p_venue_token text, p_customer_id uuid, p_first_name text DEFAULT NULL, p_last_name text DEFAULT NULL, p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_dob date DEFAULT NULL, p_household_id uuid DEFAULT NULL, p_consent_marketing boolean DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_email text := NULLIF(lower(btrim(p_email)), ''); v_existing uuid; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.venue_customers WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased' AND id <> p_customer_id LIMIT 1;
    IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'customer_exists' USING ERRCODE = 'P0001', DETAIL = v_existing::text; END IF;
  END IF;
  UPDATE public.venue_customers SET
    first_name = COALESCE(NULLIF(btrim(p_first_name), ''), first_name), last_name = COALESCE(NULLIF(btrim(p_last_name), ''), last_name),
    email = COALESCE(v_email, email), phone = COALESCE(NULLIF(btrim(p_phone), ''), phone), dob = COALESCE(p_dob, dob),
    household_id = COALESCE(p_household_id, household_id), consent_marketing = COALESCE(p_consent_marketing, consent_marketing),
    consent_at = CASE WHEN p_consent_marketing IS TRUE AND NOT consent_marketing THEN now() ELSE consent_at END,
    notes = COALESCE(NULLIF(btrim(p_notes), ''), notes), updated_at = now()
  WHERE id = p_customer_id AND venue_id = v_venue_id AND status <> 'erased' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_customer_updated', 'venue_customer', v_id::text, jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text) TO anon, authenticated;

-- restore prior member_self_signup (mig 280)
CREATE OR REPLACE FUNCTION public.member_self_signup(
  p_code text, p_first_name text, p_last_name text DEFAULT NULL, p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_consent_marketing boolean DEFAULT false, p_tier_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_link record; v_venue_id text; v_first text := NULLIF(btrim(p_first_name), ''); v_email text := NULLIF(lower(btrim(p_email)), '');
  v_phone text := NULLIF(btrim(p_phone), ''); v_existing record; v_tier record; v_cid uuid; v_mid uuid; v_pass text;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  SELECT entity_id, entity_type, action, active, expires_at, max_uses, use_count INTO v_link FROM public.invite_links WHERE code = btrim(p_code);
  IF NOT FOUND OR v_link.entity_type <> 'venue' OR v_link.action <> 'venue_landing' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF NOT v_link.active OR (v_link.expires_at IS NOT NULL AND v_link.expires_at < now()) OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive'); END IF;
  v_venue_id := v_link.entity_id;
  IF v_first IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'first_name_required'); END IF;
  IF p_tier_id IS NOT NULL THEN
    SELECT id, COALESCE((benefits->>'is_free')::boolean, false) AS is_free, COALESCE((benefits->>'self_signup')::boolean, false) AS self_signup
      INTO v_tier FROM public.venue_membership_tiers WHERE id = p_tier_id AND venue_id = v_venue_id AND active;
    IF NOT FOUND OR NOT v_tier.self_signup THEN RETURN jsonb_build_object('ok', false, 'reason', 'tier_unavailable'); END IF;
  END IF;
  IF v_email IS NOT NULL THEN
    SELECT id, status INTO v_existing FROM public.venue_customers WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased' LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'already_registered', true, 'status', v_existing.status); END IF;
  END IF;
  UPDATE public.invite_links SET use_count = use_count + 1 WHERE code = btrim(p_code);
  IF p_tier_id IS NOT NULL AND v_tier.is_free THEN
    INSERT INTO public.venue_customers (venue_id, first_name, last_name, email, phone, status, consent_marketing, consent_at)
    VALUES (v_venue_id, v_first, NULLIF(btrim(p_last_name),''), v_email, v_phone, 'active', COALESCE(p_consent_marketing,false), CASE WHEN COALESCE(p_consent_marketing,false) THEN now() ELSE NULL END)
    RETURNING id INTO v_cid;
    INSERT INTO public.venue_memberships (venue_id, customer_id, tier_id, period, amount_pence, status, started_at, renews_at)
    VALUES (v_venue_id, v_cid, p_tier_id, 'monthly', 0, 'active', current_date, DATE '2999-01-01') RETURNING id, pass_token INTO v_mid, v_pass;
    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), 'system', 'self_signup:'||btrim(p_code), 'venue_customer_self_signup', 'venue_customer', v_cid::text,
            jsonb_build_object('venue_id', v_venue_id, 'via', 'qr_venue_landing', 'tier_id', p_tier_id, 'free', true, 'auto_approved', true));
    PERFORM public.notify_venue_change(v_venue_id, 'customer_self_signup');
    RETURN jsonb_build_object('ok', true, 'already_registered', false, 'free', true, 'status', 'active', 'pass_token', v_pass);
  END IF;
  INSERT INTO public.venue_customers (venue_id, first_name, last_name, email, phone, status, requested_tier_id, consent_marketing, consent_at)
  VALUES (v_venue_id, v_first, NULLIF(btrim(p_last_name),''), v_email, v_phone, 'pending', p_tier_id, COALESCE(p_consent_marketing,false), CASE WHEN COALESCE(p_consent_marketing,false) THEN now() ELSE NULL END)
  RETURNING id INTO v_cid;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), 'system', 'self_signup:'||btrim(p_code), 'venue_customer_self_signup', 'venue_customer', v_cid::text,
          jsonb_build_object('venue_id', v_venue_id, 'via', 'qr_venue_landing', 'tier_id', p_tier_id, 'free', false));
  PERFORM public.notify_venue_change(v_venue_id, 'customer_self_signup');
  RETURN jsonb_build_object('ok', true, 'already_registered', false, 'free', false, 'status', 'pending');
END; $fn$;
REVOKE ALL ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean,uuid) TO anon, authenticated;

-- venue_list_customers_people + venue_erase_customer: re-create the pre-282 bodies
CREATE OR REPLACE FUNCTION public.venue_list_customers_people(p_venue_token text, p_include_erased boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.first_name, c.last_name), '[]'::jsonb) INTO v_rows
    FROM (SELECT vc.id, vc.venue_id, vc.first_name, vc.last_name, vc.email, vc.phone, vc.dob, vc.household_id,
                 vc.status, vc.consent_marketing, vc.consent_at, vc.created_at, vc.updated_at,
                 vc.requested_tier_id, t.name AS requested_tier_name
            FROM public.venue_customers vc LEFT JOIN public.venue_membership_tiers t ON t.id = vc.requested_tier_id
           WHERE vc.venue_id = v_venue_id AND (p_include_erased OR vc.status <> 'erased')) c;
  RETURN jsonb_build_object('ok', true, 'customers', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_customers_people(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_customers_people(text,boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.venue_erase_customer(p_venue_token text, p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.venue_customers SET first_name='[erased]', last_name=NULL, email=NULL, phone=NULL, dob=NULL,
    household_id=NULL, notes=NULL, consent_marketing=false, consent_at=NULL, status='erased', updated_at=now()
  WHERE id = p_customer_id AND venue_id = v_venue_id AND status <> 'erased' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_customer_erased', 'venue_customer', v_id::text, jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_erase_customer(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_erase_customer(text,uuid) TO anon, authenticated;

-- finally drop the columns
ALTER TABLE public.venue_customers
  DROP COLUMN IF EXISTS gender, DROP COLUMN IF EXISTS address_line1, DROP COLUMN IF EXISTS address_line2,
  DROP COLUMN IF EXISTS address_city, DROP COLUMN IF EXISTS address_postcode,
  DROP COLUMN IF EXISTS emergency_name, DROP COLUMN IF EXISTS emergency_relationship, DROP COLUMN IF EXISTS emergency_phone,
  DROP COLUMN IF EXISTS medical_conditions, DROP COLUMN IF EXISTS allergies, DROP COLUMN IF EXISTS medications, DROP COLUMN IF EXISTS gp_details,
  DROP COLUMN IF EXISTS guardian_name, DROP COLUMN IF EXISTS guardian_relationship, DROP COLUMN IF EXISTS guardian_phone, DROP COLUMN IF EXISTS guardian_email,
  DROP COLUMN IF EXISTS consent_data_processing, DROP COLUMN IF EXISTS consent_data_processing_at,
  DROP COLUMN IF EXISTS consent_terms, DROP COLUMN IF EXISTS consent_terms_at,
  DROP COLUMN IF EXISTS consent_photo, DROP COLUMN IF EXISTS consent_photo_at,
  DROP COLUMN IF EXISTS consent_medical, DROP COLUMN IF EXISTS consent_medical_at;
