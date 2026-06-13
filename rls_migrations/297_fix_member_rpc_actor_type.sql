-- Migration 297 — Fix actor_type in 5 member RPCs
-- Bug: migs 295+296 used actor_type='member' which violates audit_events_actor_type_check.
-- Valid values: 'player','team_admin','vice_captain','club_admin','super_admin',
--               'service_role','system','venue_admin','league_admin','platform_admin',
--               'referee','company_admin'.
-- Fix: change actor_type 'member' → 'player' in all 5 member-domain RPCs.
-- Affects: member_register_child, member_update_child, member_accept_consent (mig 295),
--          member_self_create_profile, member_enrol_membership (mig 296).
-- Caught by ephemeral-verify run session 99.

-- ─── member_register_child ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_register_child(
  p_first_name   text,
  p_last_name    text,
  p_dob          date    DEFAULT NULL,
  p_relationship text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_caller_profile uuid;
  v_child_id       uuid;
BEGIN
  SELECT id INTO v_caller_profile
  FROM member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  INSERT INTO member_profiles (first_name, last_name, dob)
  VALUES (p_first_name, p_last_name, p_dob)
  RETURNING id INTO v_child_id;

  INSERT INTO member_guardians (
    child_profile_id, guardian_profile_id,
    relationship, is_primary, can_collect, invite_state, accepted_at
  ) VALUES (
    v_child_id, v_caller_profile,
    p_relationship, true, true, 'accepted', now()
  );

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_user_id, 'player', 'member_child_registered',
    'member_profile', v_child_id::text,
    jsonb_build_object(
      'child_profile_id',    v_child_id,
      'guardian_profile_id', v_caller_profile
    )
  );

  RETURN jsonb_build_object('child_profile_id', v_child_id);
END;
$$;

REVOKE ALL ON FUNCTION public.member_register_child(text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_register_child(text, text, date, text) TO authenticated;

-- ─── member_update_child ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_update_child(
  p_child_profile_id uuid,
  p_updates          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_caller_profile uuid;
  v_is_guardian    boolean;
  v_medical        boolean;
  v_profile        record;
BEGIN
  SELECT id INTO v_caller_profile
  FROM member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM member_guardians
    WHERE child_profile_id    = p_child_profile_id
      AND guardian_profile_id = v_caller_profile
      AND invite_state        = 'accepted'
  ) INTO v_is_guardian;

  IF NOT v_is_guardian THEN
    RAISE EXCEPTION 'not_guardian';
  END IF;

  v_medical := (
    p_updates ? 'medical_conditions' OR
    p_updates ? 'allergies'          OR
    p_updates ? 'medications'        OR
    p_updates ? 'gp_details'
  );

  UPDATE member_profiles SET
    first_name                    = CASE WHEN p_updates ? 'first_name'                   THEN (p_updates->>'first_name')                   ELSE first_name                    END,
    last_name                     = CASE WHEN p_updates ? 'last_name'                    THEN (p_updates->>'last_name')                    ELSE last_name                     END,
    phone                         = CASE WHEN p_updates ? 'phone'                         THEN (p_updates->>'phone')                         ELSE phone                         END,
    gender                        = CASE WHEN p_updates ? 'gender'                        THEN (p_updates->>'gender')                        ELSE gender                        END,
    address_line1                 = CASE WHEN p_updates ? 'address_line1'                 THEN (p_updates->>'address_line1')                 ELSE address_line1                 END,
    address_line2                 = CASE WHEN p_updates ? 'address_line2'                 THEN (p_updates->>'address_line2')                 ELSE address_line2                 END,
    address_city                  = CASE WHEN p_updates ? 'address_city'                  THEN (p_updates->>'address_city')                  ELSE address_city                  END,
    address_postcode              = CASE WHEN p_updates ? 'address_postcode'              THEN (p_updates->>'address_postcode')              ELSE address_postcode              END,
    ec1_name                      = CASE WHEN p_updates ? 'ec1_name'                      THEN (p_updates->>'ec1_name')                      ELSE ec1_name                      END,
    ec1_relationship              = CASE WHEN p_updates ? 'ec1_relationship'              THEN (p_updates->>'ec1_relationship')              ELSE ec1_relationship              END,
    ec1_phone                     = CASE WHEN p_updates ? 'ec1_phone'                     THEN (p_updates->>'ec1_phone')                     ELSE ec1_phone                     END,
    ec2_name                      = CASE WHEN p_updates ? 'ec2_name'                      THEN (p_updates->>'ec2_name')                      ELSE ec2_name                      END,
    ec2_relationship              = CASE WHEN p_updates ? 'ec2_relationship'              THEN (p_updates->>'ec2_relationship')              ELSE ec2_relationship              END,
    ec2_phone                     = CASE WHEN p_updates ? 'ec2_phone'                     THEN (p_updates->>'ec2_phone')                     ELSE ec2_phone                     END,
    send_notes                    = CASE WHEN p_updates ? 'send_notes'                    THEN (p_updates->>'send_notes')                    ELSE send_notes                    END,
    dietary_notes                 = CASE WHEN p_updates ? 'dietary_notes'                 THEN (p_updates->>'dietary_notes')                 ELSE dietary_notes                 END,
    consent_emergency_treatment   = CASE WHEN p_updates ? 'consent_emergency_treatment'   THEN (p_updates->>'consent_emergency_treatment')::boolean   ELSE consent_emergency_treatment   END,
    consent_administer_medication = CASE WHEN p_updates ? 'consent_administer_medication' THEN (p_updates->>'consent_administer_medication')::boolean ELSE consent_administer_medication END,
    may_leave_unaccompanied       = CASE WHEN p_updates ? 'may_leave_unaccompanied'       THEN (p_updates->>'may_leave_unaccompanied')::boolean       ELSE may_leave_unaccompanied       END,
    authorised_collectors         = CASE WHEN p_updates ? 'authorised_collectors'         THEN (p_updates->>'authorised_collectors')         ELSE authorised_collectors         END,
    photo_consent                 = CASE WHEN p_updates ? 'photo_consent'                 THEN (p_updates->'photo_consent')                 ELSE photo_consent                 END,
    medical_conditions            = CASE WHEN p_updates ? 'medical_conditions'            THEN (p_updates->>'medical_conditions')            ELSE medical_conditions            END,
    allergies                     = CASE WHEN p_updates ? 'allergies'                     THEN (p_updates->>'allergies')                     ELSE allergies                     END,
    medications                   = CASE WHEN p_updates ? 'medications'                   THEN (p_updates->>'medications')                   ELSE medications                   END,
    gp_details                    = CASE WHEN p_updates ? 'gp_details'                   THEN (p_updates->>'gp_details')                   ELSE gp_details                    END,
    updated_at                    = now()
  WHERE id = p_child_profile_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_user_id, 'player',
    CASE WHEN v_medical THEN 'member_child_medical_updated' ELSE 'member_child_profile_updated' END,
    'member_profile', p_child_profile_id::text,
    jsonb_build_object(
      'child_profile_id',    p_child_profile_id,
      'guardian_profile_id', v_caller_profile,
      'fields_updated',      (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_updates) k),
      'medical',             v_medical
    )
  );

  SELECT * INTO v_profile FROM member_profiles WHERE id = p_child_profile_id LIMIT 1;

  RETURN jsonb_build_object(
    'found',                         true,
    'id',                            v_profile.id,
    'first_name',                    v_profile.first_name,
    'last_name',                     v_profile.last_name,
    'phone',                         v_profile.phone,
    'dob',                           v_profile.dob,
    'gender',                        v_profile.gender,
    'address_line1',                 v_profile.address_line1,
    'address_line2',                 v_profile.address_line2,
    'address_city',                  v_profile.address_city,
    'address_postcode',              v_profile.address_postcode,
    'ec1_name',                      v_profile.ec1_name,
    'ec1_relationship',              v_profile.ec1_relationship,
    'ec1_phone',                     v_profile.ec1_phone,
    'ec2_name',                      v_profile.ec2_name,
    'ec2_relationship',              v_profile.ec2_relationship,
    'ec2_phone',                     v_profile.ec2_phone,
    'send_notes',                    v_profile.send_notes,
    'dietary_notes',                 v_profile.dietary_notes,
    'consent_emergency_treatment',   v_profile.consent_emergency_treatment,
    'consent_administer_medication', v_profile.consent_administer_medication,
    'may_leave_unaccompanied',       v_profile.may_leave_unaccompanied,
    'authorised_collectors',         v_profile.authorised_collectors,
    'photo_consent',                 v_profile.photo_consent,
    'medical_conditions',            v_profile.medical_conditions,
    'allergies',                     v_profile.allergies,
    'medications',                   v_profile.medications,
    'gp_details',                    v_profile.gp_details,
    'created_at',                    v_profile.created_at,
    'updated_at',                    v_profile.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_update_child(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_update_child(uuid, jsonb) TO authenticated;

-- ─── member_accept_consent ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_accept_consent(
  p_document_id             uuid,
  p_typed_signature         text,
  p_on_behalf_of_profile_id uuid    DEFAULT NULL,
  p_ip_address              text    DEFAULT NULL,
  p_user_agent              text    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_caller_prof  uuid;
  v_member_prof  uuid;
  v_guardian_of  uuid;
  v_sig          text := NULLIF(btrim(p_typed_signature), '');
  v_acc_id       uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF v_sig IS NULL THEN RAISE EXCEPTION 'signature_required' USING ERRCODE='P0001'; END IF;

  SELECT id INTO v_caller_prof FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_prof IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  IF p_on_behalf_of_profile_id IS NULL THEN
    v_member_prof := v_caller_prof;
    v_guardian_of := NULL;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
       WHERE child_profile_id = p_on_behalf_of_profile_id
         AND guardian_profile_id = v_caller_prof
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_member_prof := p_on_behalf_of_profile_id;
    v_guardian_of := v_caller_prof;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.policy_documents WHERE id = p_document_id AND is_current) THEN
    RAISE EXCEPTION 'document_not_current' USING ERRCODE='P0001';
  END IF;

  BEGIN
    INSERT INTO public.consent_acceptances
      (document_id, member_profile_id, signed_on_behalf_of, typed_signature,
       ip_address, user_agent, auth_user_id)
    VALUES
      (p_document_id, v_member_prof, v_guardian_of, v_sig,
       p_ip_address, p_user_agent, v_uid)
    RETURNING id INTO v_acc_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_accepted' USING ERRCODE='P0001';
  END;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'player', v_caller_prof::text,
          'consent_accepted', 'consent_acceptance', v_acc_id::text,
          jsonb_build_object('document_id', p_document_id,
                             'member_profile_id', v_member_prof,
                             'signed_on_behalf_of', v_guardian_of));
  RETURN jsonb_build_object('ok', true, 'acceptance_id', v_acc_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.member_accept_consent(uuid,text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_accept_consent(uuid,text,uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.member_accept_consent(uuid,text,uuid,text,text) TO authenticated;

-- ─── member_self_create_profile ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_self_create_profile(
  p_first_name text,
  p_last_name  text DEFAULT NULL,
  p_email      text DEFAULT NULL,
  p_dob        date DEFAULT NULL,
  p_phone      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF p_first_name IS NULL OR btrim(p_first_name) = '' THEN
    RAISE EXCEPTION 'first_name_required' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_profiles WHERE auth_user_id = v_uid) THEN
    RAISE EXCEPTION 'profile_exists' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.member_profiles (first_name, last_name, email, dob, phone, auth_user_id)
  VALUES (
    btrim(p_first_name),
    NULLIF(btrim(COALESCE(p_last_name,'')), ''),
    NULLIF(btrim(COALESCE(p_email,'')), ''),
    p_dob,
    NULLIF(btrim(COALESCE(p_phone,'')), ''),
    v_uid
  )
  RETURNING id INTO v_profile_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_uid, 'player', 'member_profile_self_created',
    'member_profile', v_profile_id::text,
    jsonb_build_object('source', 'q_signup')
  );

  RETURN jsonb_build_object('ok', true, 'profile_id', v_profile_id);
END;
$$;
REVOKE ALL ON FUNCTION public.member_self_create_profile(text,text,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_self_create_profile(text,text,text,date,text) TO authenticated;

-- ─── member_enrol_membership ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_enrol_membership(
  p_invite_code    text,
  p_tier_id        uuid,
  p_period         text,
  p_for_profile_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_uid            uuid := auth.uid();
  v_link           record;
  v_venue_id       text;
  v_payer_profile  uuid;
  v_member_profile uuid;
  v_tier           record;
  v_price          int;
  v_club_id        text;
  v_mid            uuid;
  v_renews         date;
  v_pass_token     text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;

  SELECT entity_id, active INTO v_link
  FROM public.invite_links
  WHERE code = btrim(p_invite_code)
    AND entity_type = 'venue'
    AND action = 'venue_landing';
  IF NOT FOUND OR NOT v_link.active THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_link.entity_id;

  IF p_period NOT IN ('monthly','quarterly','annual','season') THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_payer_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_payer_profile IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001';
  END IF;

  IF p_for_profile_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE child_profile_id    = p_for_profile_id
        AND guardian_profile_id = v_payer_profile
        AND invite_state        = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_member_profile := p_for_profile_id;
  ELSE
    v_member_profile := v_payer_profile;
  END IF;

  SELECT id, season_end, pricing_model INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active
    AND COALESCE((benefits->>'self_signup')::boolean, false) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;

  SELECT price_pence INTO v_price
  FROM public.venue_tier_prices
  WHERE tier_id = p_tier_id AND period = p_period AND active;
  IF v_price IS NULL THEN RAISE EXCEPTION 'price_not_set' USING ERRCODE='P0001'; END IF;

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  IF p_period = 'season' THEN
    v_renews := COALESCE(v_tier.season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, payer_profile_id, pricing_model
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_price, 'active', v_renews,
    v_club_id, v_member_profile, v_payer_profile, v_tier.pricing_model
  )
  RETURNING id, pass_token INTO v_mid, v_pass_token;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue_id, v_uid, 'player', 'member_self_enrolled',
    'venue_membership', v_mid::text,
    jsonb_build_object(
      'tier_id',           p_tier_id,
      'period',            p_period,
      'member_profile_id', v_member_profile,
      'payer_profile_id',  v_payer_profile,
      'club_id',           v_club_id,
      'amount_pence',      v_price
    )
  );

  RETURN jsonb_build_object(
    'ok',            true,
    'membership_id', v_mid,
    'pass_token',    v_pass_token
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_enrol_membership(text,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_enrol_membership(text,uuid,text,uuid) TO authenticated;
