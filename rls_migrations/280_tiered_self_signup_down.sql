-- 280_tiered_self_signup_down.sql — reverse of 280_tiered_self_signup.sql
DROP FUNCTION IF EXISTS public.venue_approve_and_enrol(text,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.get_venue_signup_tiers(text);

-- restore member_self_signup to its mig-275 6-arg form
DROP FUNCTION IF EXISTS public.member_self_signup(text,text,text,text,text,boolean,uuid);
CREATE OR REPLACE FUNCTION public.member_self_signup(
  p_code text, p_first_name text, p_last_name text DEFAULT NULL, p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_consent_marketing boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_link record; v_venue_id text;
  v_first text := NULLIF(btrim(p_first_name), ''); v_email text := NULLIF(lower(btrim(p_email)), '');
  v_phone text := NULLIF(btrim(p_phone), ''); v_existing record; v_id uuid;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  SELECT entity_id, entity_type, action, active, expires_at, max_uses, use_count INTO v_link
    FROM public.invite_links WHERE code = btrim(p_code);
  IF NOT FOUND OR v_link.entity_type <> 'venue' OR v_link.action <> 'venue_landing' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF NOT v_link.active OR (v_link.expires_at IS NOT NULL AND v_link.expires_at < now())
     OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive'); END IF;
  v_venue_id := v_link.entity_id;
  IF v_first IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'first_name_required'); END IF;
  IF v_email IS NOT NULL THEN
    SELECT id, status INTO v_existing FROM public.venue_customers
     WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased' LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'already_registered', true, 'status', v_existing.status); END IF;
  END IF;
  INSERT INTO public.venue_customers (venue_id, first_name, last_name, email, phone, status, consent_marketing, consent_at)
  VALUES (v_venue_id, v_first, NULLIF(btrim(p_last_name),''), v_email, v_phone, 'pending',
          COALESCE(p_consent_marketing,false), CASE WHEN COALESCE(p_consent_marketing,false) THEN now() ELSE NULL END)
  RETURNING id INTO v_id;
  UPDATE public.invite_links SET use_count = use_count + 1 WHERE code = btrim(p_code);
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), 'system', 'self_signup:'||btrim(p_code), 'venue_customer_self_signup', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'via', 'qr_venue_landing'));
  PERFORM public.notify_venue_change(v_venue_id, 'customer_self_signup');
  RETURN jsonb_build_object('ok', true, 'already_registered', false, 'status', 'pending');
END; $fn$;
REVOKE ALL ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean) TO anon, authenticated;

-- restore venue_list_customers_people to its mig-270 shape (no requested_tier)
CREATE OR REPLACE FUNCTION public.venue_list_customers_people(p_venue_token text, p_include_erased boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.first_name, c.last_name), '[]'::jsonb) INTO v_rows
    FROM (SELECT id, venue_id, first_name, last_name, email, phone, dob, household_id, status,
                 consent_marketing, consent_at, created_at, updated_at
            FROM public.venue_customers
           WHERE venue_id = v_venue_id AND (p_include_erased OR status <> 'erased')) c;
  RETURN jsonb_build_object('ok', true, 'customers', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_customers_people(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_customers_people(text,boolean) TO anon, authenticated;

ALTER TABLE public.venue_customers DROP COLUMN IF EXISTS requested_tier_id;
