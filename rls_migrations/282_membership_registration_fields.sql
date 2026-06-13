-- 282_membership_registration_fields.sql
--
-- 360Player-style full registration record on membership signup (operator
-- decision 2026-06-13: collect ALL of it, on BOTH the public /q self-signup form
-- and the venue dashboard).
--
-- Extends venue_customers with identity (gender + structured address), emergency
-- contact, medical/safeguarding info, guardian details (for under-18s), and an
-- explicit consent suite. Emergency-contact + medical are SPECIAL-CATEGORY PII
-- under UK GDPR, so:
--   • each consent is a boolean + timestamptz pair (mirrors consent_marketing /
--     consent_at); the _at is stamped only when the boolean goes true;
--   • venue_erase_customer (right-to-erasure) scrubs EVERY new PII column and
--     resets EVERY new consent — see section 5;
--   • audit_events store FLAGS not PII values (is_minor / has_medical / consent
--     booleans), never the data itself.
--
-- Validation (enforced server-side here AND mirrored in both forms):
--   • consent_data_processing + consent_terms required to submit (consent_required)
--   • dob < 18y → guardian_name + guardian_phone required (guardian_required)
--   • any medical field filled → consent_medical required (medical_consent_required)
--
-- All columns additive + nullable; existing dob/household_id/consent_marketing kept.

-- ── 1. Columns ────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS gender                     text,
  ADD COLUMN IF NOT EXISTS address_line1              text,
  ADD COLUMN IF NOT EXISTS address_line2              text,
  ADD COLUMN IF NOT EXISTS address_city               text,
  ADD COLUMN IF NOT EXISTS address_postcode           text,
  ADD COLUMN IF NOT EXISTS emergency_name             text,
  ADD COLUMN IF NOT EXISTS emergency_relationship     text,
  ADD COLUMN IF NOT EXISTS emergency_phone            text,
  ADD COLUMN IF NOT EXISTS medical_conditions         text,
  ADD COLUMN IF NOT EXISTS allergies                  text,
  ADD COLUMN IF NOT EXISTS medications                text,
  ADD COLUMN IF NOT EXISTS gp_details                 text,
  ADD COLUMN IF NOT EXISTS guardian_name              text,
  ADD COLUMN IF NOT EXISTS guardian_relationship      text,
  ADD COLUMN IF NOT EXISTS guardian_phone             text,
  ADD COLUMN IF NOT EXISTS guardian_email             text,
  ADD COLUMN IF NOT EXISTS consent_data_processing    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_data_processing_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_terms              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_terms_at           timestamptz,
  ADD COLUMN IF NOT EXISTS consent_photo              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_photo_at           timestamptz,
  ADD COLUMN IF NOT EXISTS consent_medical            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_medical_at         timestamptz;

-- ── 2. venue_create_customer (WRITE, gated) — widened ─────────────────────────
DROP FUNCTION IF EXISTS public.venue_create_customer(text,text,text,text,text,date,uuid,boolean);
CREATE OR REPLACE FUNCTION public.venue_create_customer(
  p_venue_token             text,
  p_first_name              text,
  p_last_name               text DEFAULT NULL,
  p_email                   text DEFAULT NULL,
  p_phone                   text DEFAULT NULL,
  p_dob                     date DEFAULT NULL,
  p_household_id            uuid DEFAULT NULL,
  p_consent_marketing       boolean DEFAULT false,
  p_gender                  text DEFAULT NULL,
  p_address_line1           text DEFAULT NULL,
  p_address_line2           text DEFAULT NULL,
  p_address_city            text DEFAULT NULL,
  p_address_postcode        text DEFAULT NULL,
  p_emergency_name          text DEFAULT NULL,
  p_emergency_relationship  text DEFAULT NULL,
  p_emergency_phone         text DEFAULT NULL,
  p_medical_conditions      text DEFAULT NULL,
  p_allergies               text DEFAULT NULL,
  p_medications             text DEFAULT NULL,
  p_gp_details              text DEFAULT NULL,
  p_guardian_name           text DEFAULT NULL,
  p_guardian_relationship   text DEFAULT NULL,
  p_guardian_phone          text DEFAULT NULL,
  p_guardian_email          text DEFAULT NULL,
  p_consent_data_processing boolean DEFAULT false,
  p_consent_terms           boolean DEFAULT false,
  p_consent_photo           boolean DEFAULT false,
  p_consent_medical         boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller      record;
  v_venue_id    text;
  v_first       text := NULLIF(btrim(p_first_name), '');
  v_email       text := NULLIF(lower(btrim(p_email)), '');
  v_phone       text := NULLIF(btrim(p_phone), '');
  v_existing    uuid;
  v_id          uuid;
  v_under18     boolean := (p_dob IS NOT NULL AND p_dob > (current_date - INTERVAL '18 years'));
  v_has_medical boolean := (NULLIF(btrim(p_medical_conditions),'') IS NOT NULL
                            OR NULLIF(btrim(p_allergies),'')      IS NOT NULL
                            OR NULLIF(btrim(p_medications),'')    IS NOT NULL
                            OR NULLIF(btrim(p_gp_details),'')     IS NOT NULL);
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (COALESCE(p_consent_data_processing,false) AND COALESCE(p_consent_terms,false)) THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_under18 AND (NULLIF(btrim(p_guardian_name),'') IS NULL OR NULLIF(btrim(p_guardian_phone),'') IS NULL) THEN
    RAISE EXCEPTION 'guardian_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_has_medical AND NOT COALESCE(p_consent_medical,false) THEN
    RAISE EXCEPTION 'medical_consent_required' USING ERRCODE = 'P0001';
  END IF;

  -- returning-person de-dup on email within the venue
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.venue_customers
     WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased'
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'customer_exists' USING ERRCODE = 'P0001', DETAIL = v_existing::text;
    END IF;
  END IF;

  INSERT INTO public.venue_customers
    (venue_id, first_name, last_name, email, phone, dob, household_id, gender,
     address_line1, address_line2, address_city, address_postcode,
     emergency_name, emergency_relationship, emergency_phone,
     medical_conditions, allergies, medications, gp_details,
     guardian_name, guardian_relationship, guardian_phone, guardian_email,
     consent_marketing, consent_at,
     consent_data_processing, consent_data_processing_at,
     consent_terms, consent_terms_at,
     consent_photo, consent_photo_at,
     consent_medical, consent_medical_at)
  VALUES
    (v_venue_id, v_first, NULLIF(btrim(p_last_name), ''), v_email, v_phone, p_dob, p_household_id,
     NULLIF(btrim(p_gender),''),
     NULLIF(btrim(p_address_line1),''), NULLIF(btrim(p_address_line2),''),
     NULLIF(btrim(p_address_city),''),  NULLIF(btrim(p_address_postcode),''),
     NULLIF(btrim(p_emergency_name),''), NULLIF(btrim(p_emergency_relationship),''), NULLIF(btrim(p_emergency_phone),''),
     NULLIF(btrim(p_medical_conditions),''), NULLIF(btrim(p_allergies),''), NULLIF(btrim(p_medications),''), NULLIF(btrim(p_gp_details),''),
     NULLIF(btrim(p_guardian_name),''), NULLIF(btrim(p_guardian_relationship),''), NULLIF(btrim(p_guardian_phone),''), NULLIF(btrim(p_guardian_email),''),
     COALESCE(p_consent_marketing,false),       CASE WHEN COALESCE(p_consent_marketing,false)       THEN now() END,
     COALESCE(p_consent_data_processing,false),  CASE WHEN COALESCE(p_consent_data_processing,false)  THEN now() END,
     COALESCE(p_consent_terms,false),            CASE WHEN COALESCE(p_consent_terms,false)            THEN now() END,
     COALESCE(p_consent_photo,false),            CASE WHEN COALESCE(p_consent_photo,false)            THEN now() END,
     COALESCE(p_consent_medical,false),          CASE WHEN COALESCE(p_consent_medical,false)          THEN now() END)
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_customer_created', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id,
                             'has_email', v_email IS NOT NULL,
                             'has_phone', v_phone IS NOT NULL,
                             'is_minor', v_under18,
                             'has_medical', v_has_medical,
                             'consent_marketing', COALESCE(p_consent_marketing, false),
                             'consent_photo', COALESCE(p_consent_photo, false),
                             'consent_medical', COALESCE(p_consent_medical, false)));

  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_customer(text,text,text,text,text,date,uuid,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_customer(text,text,text,text,text,date,uuid,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean) TO anon, authenticated;

-- ── 3. venue_update_customer (WRITE, gated) — widened ─────────────────────────
-- Partial update: a NULL text/date/uuid argument leaves that field UNCHANGED.
-- Consent booleans: NULL = leave unchanged; the matching _at is stamped only on a
-- false→true transition (mirrors the existing consent_marketing logic).
DROP FUNCTION IF EXISTS public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text);
CREATE OR REPLACE FUNCTION public.venue_update_customer(
  p_venue_token             text,
  p_customer_id             uuid,
  p_first_name              text DEFAULT NULL,
  p_last_name               text DEFAULT NULL,
  p_email                   text DEFAULT NULL,
  p_phone                   text DEFAULT NULL,
  p_dob                     date DEFAULT NULL,
  p_household_id            uuid DEFAULT NULL,
  p_consent_marketing       boolean DEFAULT NULL,
  p_notes                   text DEFAULT NULL,
  p_gender                  text DEFAULT NULL,
  p_address_line1           text DEFAULT NULL,
  p_address_line2           text DEFAULT NULL,
  p_address_city            text DEFAULT NULL,
  p_address_postcode        text DEFAULT NULL,
  p_emergency_name          text DEFAULT NULL,
  p_emergency_relationship  text DEFAULT NULL,
  p_emergency_phone         text DEFAULT NULL,
  p_medical_conditions      text DEFAULT NULL,
  p_allergies               text DEFAULT NULL,
  p_medications             text DEFAULT NULL,
  p_gp_details              text DEFAULT NULL,
  p_guardian_name           text DEFAULT NULL,
  p_guardian_relationship   text DEFAULT NULL,
  p_guardian_phone          text DEFAULT NULL,
  p_guardian_email          text DEFAULT NULL,
  p_consent_data_processing boolean DEFAULT NULL,
  p_consent_terms           boolean DEFAULT NULL,
  p_consent_photo           boolean DEFAULT NULL,
  p_consent_medical         boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_email    text := NULLIF(lower(btrim(p_email)), '');
  v_existing uuid;
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  -- if email is changing, re-check the venue de-dup
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.venue_customers
     WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased'
       AND id <> p_customer_id
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'customer_exists' USING ERRCODE = 'P0001', DETAIL = v_existing::text;
    END IF;
  END IF;

  UPDATE public.venue_customers SET
    first_name             = COALESCE(NULLIF(btrim(p_first_name), ''), first_name),
    last_name              = COALESCE(NULLIF(btrim(p_last_name), ''), last_name),
    email                  = COALESCE(v_email, email),
    phone                  = COALESCE(NULLIF(btrim(p_phone), ''), phone),
    dob                    = COALESCE(p_dob, dob),
    household_id           = COALESCE(p_household_id, household_id),
    gender                 = COALESCE(NULLIF(btrim(p_gender), ''), gender),
    address_line1          = COALESCE(NULLIF(btrim(p_address_line1), ''), address_line1),
    address_line2          = COALESCE(NULLIF(btrim(p_address_line2), ''), address_line2),
    address_city           = COALESCE(NULLIF(btrim(p_address_city), ''), address_city),
    address_postcode       = COALESCE(NULLIF(btrim(p_address_postcode), ''), address_postcode),
    emergency_name         = COALESCE(NULLIF(btrim(p_emergency_name), ''), emergency_name),
    emergency_relationship = COALESCE(NULLIF(btrim(p_emergency_relationship), ''), emergency_relationship),
    emergency_phone        = COALESCE(NULLIF(btrim(p_emergency_phone), ''), emergency_phone),
    medical_conditions     = COALESCE(NULLIF(btrim(p_medical_conditions), ''), medical_conditions),
    allergies              = COALESCE(NULLIF(btrim(p_allergies), ''), allergies),
    medications            = COALESCE(NULLIF(btrim(p_medications), ''), medications),
    gp_details             = COALESCE(NULLIF(btrim(p_gp_details), ''), gp_details),
    guardian_name          = COALESCE(NULLIF(btrim(p_guardian_name), ''), guardian_name),
    guardian_relationship  = COALESCE(NULLIF(btrim(p_guardian_relationship), ''), guardian_relationship),
    guardian_phone         = COALESCE(NULLIF(btrim(p_guardian_phone), ''), guardian_phone),
    guardian_email         = COALESCE(NULLIF(btrim(p_guardian_email), ''), guardian_email),
    consent_marketing      = COALESCE(p_consent_marketing, consent_marketing),
    consent_at             = CASE WHEN p_consent_marketing IS TRUE AND NOT consent_marketing THEN now()
                                  ELSE consent_at END,
    consent_data_processing    = COALESCE(p_consent_data_processing, consent_data_processing),
    consent_data_processing_at = CASE WHEN p_consent_data_processing IS TRUE AND NOT consent_data_processing THEN now()
                                      ELSE consent_data_processing_at END,
    consent_terms          = COALESCE(p_consent_terms, consent_terms),
    consent_terms_at       = CASE WHEN p_consent_terms IS TRUE AND NOT consent_terms THEN now()
                                  ELSE consent_terms_at END,
    consent_photo          = COALESCE(p_consent_photo, consent_photo),
    consent_photo_at       = CASE WHEN p_consent_photo IS TRUE AND NOT consent_photo THEN now()
                                  ELSE consent_photo_at END,
    consent_medical        = COALESCE(p_consent_medical, consent_medical),
    consent_medical_at     = CASE WHEN p_consent_medical IS TRUE AND NOT consent_medical THEN now()
                                  ELSE consent_medical_at END,
    notes                  = COALESCE(NULLIF(btrim(p_notes), ''), notes),
    updated_at             = now()
  WHERE id = p_customer_id AND venue_id = v_venue_id AND status <> 'erased'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_customer_updated', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id));

  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean) TO anon, authenticated;

-- ── 4. member_self_signup (PUBLIC) — widened ──────────────────────────────────
DROP FUNCTION IF EXISTS public.member_self_signup(text,text,text,text,text,boolean,uuid);
CREATE OR REPLACE FUNCTION public.member_self_signup(
  p_code                    text,
  p_first_name              text,
  p_last_name               text DEFAULT NULL,
  p_email                   text DEFAULT NULL,
  p_phone                   text DEFAULT NULL,
  p_consent_marketing       boolean DEFAULT false,
  p_tier_id                 uuid DEFAULT NULL,
  p_dob                     date DEFAULT NULL,
  p_gender                  text DEFAULT NULL,
  p_address_line1           text DEFAULT NULL,
  p_address_line2           text DEFAULT NULL,
  p_address_city            text DEFAULT NULL,
  p_address_postcode        text DEFAULT NULL,
  p_emergency_name          text DEFAULT NULL,
  p_emergency_relationship  text DEFAULT NULL,
  p_emergency_phone         text DEFAULT NULL,
  p_medical_conditions      text DEFAULT NULL,
  p_allergies               text DEFAULT NULL,
  p_medications             text DEFAULT NULL,
  p_gp_details              text DEFAULT NULL,
  p_guardian_name           text DEFAULT NULL,
  p_guardian_relationship   text DEFAULT NULL,
  p_guardian_phone          text DEFAULT NULL,
  p_guardian_email          text DEFAULT NULL,
  p_consent_data_processing boolean DEFAULT false,
  p_consent_terms           boolean DEFAULT false,
  p_consent_photo           boolean DEFAULT false,
  p_consent_medical         boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_link        record;
  v_venue_id    text;
  v_first       text := NULLIF(btrim(p_first_name), '');
  v_email       text := NULLIF(lower(btrim(p_email)), '');
  v_phone       text := NULLIF(btrim(p_phone), '');
  v_existing    record;
  v_tier        record;
  v_cid         uuid;
  v_mid         uuid;
  v_pass        text;
  v_under18     boolean := (p_dob IS NOT NULL AND p_dob > (current_date - INTERVAL '18 years'));
  v_has_medical boolean := (NULLIF(btrim(p_medical_conditions),'') IS NOT NULL
                            OR NULLIF(btrim(p_allergies),'')      IS NOT NULL
                            OR NULLIF(btrim(p_medications),'')    IS NOT NULL
                            OR NULLIF(btrim(p_gp_details),'')     IS NOT NULL);
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
  IF NOT (COALESCE(p_consent_data_processing,false) AND COALESCE(p_consent_terms,false)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'consent_required'); END IF;
  IF v_under18 AND (NULLIF(btrim(p_guardian_name),'') IS NULL OR NULLIF(btrim(p_guardian_phone),'') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'guardian_required'); END IF;
  IF v_has_medical AND NOT COALESCE(p_consent_medical,false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'medical_consent_required'); END IF;

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
    INSERT INTO public.venue_customers
      (venue_id, first_name, last_name, email, phone, dob, gender, status,
       address_line1, address_line2, address_city, address_postcode,
       emergency_name, emergency_relationship, emergency_phone,
       medical_conditions, allergies, medications, gp_details,
       guardian_name, guardian_relationship, guardian_phone, guardian_email,
       consent_marketing, consent_at,
       consent_data_processing, consent_data_processing_at,
       consent_terms, consent_terms_at,
       consent_photo, consent_photo_at,
       consent_medical, consent_medical_at)
    VALUES
      (v_venue_id, v_first, NULLIF(btrim(p_last_name),''), v_email, v_phone, p_dob, NULLIF(btrim(p_gender),''), 'active',
       NULLIF(btrim(p_address_line1),''), NULLIF(btrim(p_address_line2),''), NULLIF(btrim(p_address_city),''), NULLIF(btrim(p_address_postcode),''),
       NULLIF(btrim(p_emergency_name),''), NULLIF(btrim(p_emergency_relationship),''), NULLIF(btrim(p_emergency_phone),''),
       NULLIF(btrim(p_medical_conditions),''), NULLIF(btrim(p_allergies),''), NULLIF(btrim(p_medications),''), NULLIF(btrim(p_gp_details),''),
       NULLIF(btrim(p_guardian_name),''), NULLIF(btrim(p_guardian_relationship),''), NULLIF(btrim(p_guardian_phone),''), NULLIF(btrim(p_guardian_email),''),
       COALESCE(p_consent_marketing,false),       CASE WHEN COALESCE(p_consent_marketing,false)      THEN now() END,
       COALESCE(p_consent_data_processing,false),  CASE WHEN COALESCE(p_consent_data_processing,false) THEN now() END,
       COALESCE(p_consent_terms,false),            CASE WHEN COALESCE(p_consent_terms,false)           THEN now() END,
       COALESCE(p_consent_photo,false),            CASE WHEN COALESCE(p_consent_photo,false)           THEN now() END,
       COALESCE(p_consent_medical,false),          CASE WHEN COALESCE(p_consent_medical,false)         THEN now() END)
    RETURNING id INTO v_cid;

    INSERT INTO public.venue_memberships (venue_id, customer_id, tier_id, period, amount_pence, status, started_at, renews_at)
    VALUES (v_venue_id, v_cid, p_tier_id, 'monthly', 0, 'active', current_date, DATE '2999-01-01')
    RETURNING id, pass_token INTO v_mid, v_pass;

    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), 'system', 'self_signup:'||btrim(p_code), 'venue_customer_self_signup', 'venue_customer', v_cid::text,
            jsonb_build_object('venue_id', v_venue_id, 'via', 'qr_venue_landing', 'tier_id', p_tier_id, 'free', true, 'auto_approved', true,
                               'is_minor', v_under18, 'has_medical', v_has_medical));
    PERFORM public.notify_venue_change(v_venue_id, 'customer_self_signup');
    RETURN jsonb_build_object('ok', true, 'already_registered', false, 'free', true, 'status', 'active', 'pass_token', v_pass);
  END IF;

  -- PAID (or tier-less) → pending request, tagged with the chosen tier
  INSERT INTO public.venue_customers
    (venue_id, first_name, last_name, email, phone, dob, gender, status, requested_tier_id,
     address_line1, address_line2, address_city, address_postcode,
     emergency_name, emergency_relationship, emergency_phone,
     medical_conditions, allergies, medications, gp_details,
     guardian_name, guardian_relationship, guardian_phone, guardian_email,
     consent_marketing, consent_at,
     consent_data_processing, consent_data_processing_at,
     consent_terms, consent_terms_at,
     consent_photo, consent_photo_at,
     consent_medical, consent_medical_at)
  VALUES
    (v_venue_id, v_first, NULLIF(btrim(p_last_name),''), v_email, v_phone, p_dob, NULLIF(btrim(p_gender),''), 'pending', p_tier_id,
     NULLIF(btrim(p_address_line1),''), NULLIF(btrim(p_address_line2),''), NULLIF(btrim(p_address_city),''), NULLIF(btrim(p_address_postcode),''),
     NULLIF(btrim(p_emergency_name),''), NULLIF(btrim(p_emergency_relationship),''), NULLIF(btrim(p_emergency_phone),''),
     NULLIF(btrim(p_medical_conditions),''), NULLIF(btrim(p_allergies),''), NULLIF(btrim(p_medications),''), NULLIF(btrim(p_gp_details),''),
     NULLIF(btrim(p_guardian_name),''), NULLIF(btrim(p_guardian_relationship),''), NULLIF(btrim(p_guardian_phone),''), NULLIF(btrim(p_guardian_email),''),
     COALESCE(p_consent_marketing,false),       CASE WHEN COALESCE(p_consent_marketing,false)      THEN now() END,
     COALESCE(p_consent_data_processing,false),  CASE WHEN COALESCE(p_consent_data_processing,false) THEN now() END,
     COALESCE(p_consent_terms,false),            CASE WHEN COALESCE(p_consent_terms,false)           THEN now() END,
     COALESCE(p_consent_photo,false),            CASE WHEN COALESCE(p_consent_photo,false)           THEN now() END,
     COALESCE(p_consent_medical,false),          CASE WHEN COALESCE(p_consent_medical,false)         THEN now() END)
  RETURNING id INTO v_cid;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), 'system', 'self_signup:'||btrim(p_code), 'venue_customer_self_signup', 'venue_customer', v_cid::text,
          jsonb_build_object('venue_id', v_venue_id, 'via', 'qr_venue_landing', 'tier_id', p_tier_id, 'free', false,
                             'is_minor', v_under18, 'has_medical', v_has_medical));
  PERFORM public.notify_venue_change(v_venue_id, 'customer_self_signup');
  RETURN jsonb_build_object('ok', true, 'already_registered', false, 'free', false, 'status', 'pending');
END; $fn$;
REVOKE ALL ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean,uuid,date,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_self_signup(text,text,text,text,text,boolean,uuid,date,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean) TO anon, authenticated;

-- ── 5. venue_list_customers_people (READ) — return the new columns ────────────
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
             vc.gender, vc.address_line1, vc.address_line2, vc.address_city, vc.address_postcode,
             vc.emergency_name, vc.emergency_relationship, vc.emergency_phone,
             vc.medical_conditions, vc.allergies, vc.medications, vc.gp_details,
             vc.guardian_name, vc.guardian_relationship, vc.guardian_phone, vc.guardian_email,
             vc.status, vc.consent_marketing, vc.consent_at,
             vc.consent_data_processing, vc.consent_data_processing_at,
             vc.consent_terms, vc.consent_terms_at,
             vc.consent_photo, vc.consent_photo_at,
             vc.consent_medical, vc.consent_medical_at,
             vc.created_at, vc.updated_at,
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

-- ── 6. venue_erase_customer (WRITE, gated) — scrub the new PII + consents ─────
CREATE OR REPLACE FUNCTION public.venue_erase_customer(
  p_venue_token text,
  p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venue_customers SET
    first_name='[erased]', last_name=NULL, email=NULL, phone=NULL, dob=NULL,
    household_id=NULL, notes=NULL, gender=NULL,
    address_line1=NULL, address_line2=NULL, address_city=NULL, address_postcode=NULL,
    emergency_name=NULL, emergency_relationship=NULL, emergency_phone=NULL,
    medical_conditions=NULL, allergies=NULL, medications=NULL, gp_details=NULL,
    guardian_name=NULL, guardian_relationship=NULL, guardian_phone=NULL, guardian_email=NULL,
    consent_marketing=false, consent_at=NULL,
    consent_data_processing=false, consent_data_processing_at=NULL,
    consent_terms=false, consent_terms_at=NULL,
    consent_photo=false, consent_photo_at=NULL,
    consent_medical=false, consent_medical_at=NULL,
    status='erased', updated_at=now()
  WHERE id = p_customer_id AND venue_id = v_venue_id AND status <> 'erased'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_customer_erased', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id));

  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_erase_customer(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_erase_customer(text,uuid) TO anon, authenticated;
