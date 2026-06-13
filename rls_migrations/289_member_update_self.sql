-- Migration 289 — Phase 2: member_update_self + get_member_pass extension
--
-- member_update_self: authenticated member updates their own profile fields.
--   Scoped to auth.uid() — no passed profile_id, zero horizontal-access risk.
--   Email is NOT updateable (it is the claim key and immutable post-claim).
--   Medical fields (medical_conditions, allergies, medications, gp_details)
--   are special-category; any write is audit-logged per Hard Rule #9.
--   Returns the updated profile in the same shape as member_get_self.
--
-- get_member_pass extended: adds member_profile_id to the pass response so
--   the MemberPass UI can detect when the viewer is the account-holder.

-- ─── member_update_self ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_update_self(
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_profile   record;
  v_medical   boolean;
BEGIN
  -- Find the caller's own profile
  SELECT * INTO v_profile
  FROM member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- Check whether any medical (special-category) fields are being updated
  v_medical := (
    p_updates ? 'medical_conditions' OR
    p_updates ? 'allergies'          OR
    p_updates ? 'medications'        OR
    p_updates ? 'gp_details'
  );

  -- Apply updates — only touch a field when the key is present in p_updates
  UPDATE member_profiles SET
    first_name                   = CASE WHEN p_updates ? 'first_name'                  THEN (p_updates->>'first_name')                  ELSE first_name                   END,
    last_name                    = CASE WHEN p_updates ? 'last_name'                   THEN (p_updates->>'last_name')                   ELSE last_name                    END,
    phone                        = CASE WHEN p_updates ? 'phone'                        THEN (p_updates->>'phone')                        ELSE phone                        END,
    gender                       = CASE WHEN p_updates ? 'gender'                       THEN (p_updates->>'gender')                       ELSE gender                       END,
    address_line1                = CASE WHEN p_updates ? 'address_line1'                THEN (p_updates->>'address_line1')                ELSE address_line1                END,
    address_line2                = CASE WHEN p_updates ? 'address_line2'                THEN (p_updates->>'address_line2')                ELSE address_line2                END,
    address_city                 = CASE WHEN p_updates ? 'address_city'                 THEN (p_updates->>'address_city')                 ELSE address_city                 END,
    address_postcode             = CASE WHEN p_updates ? 'address_postcode'             THEN (p_updates->>'address_postcode')             ELSE address_postcode             END,
    ec1_name                     = CASE WHEN p_updates ? 'ec1_name'                     THEN (p_updates->>'ec1_name')                     ELSE ec1_name                     END,
    ec1_relationship             = CASE WHEN p_updates ? 'ec1_relationship'             THEN (p_updates->>'ec1_relationship')             ELSE ec1_relationship             END,
    ec1_phone                    = CASE WHEN p_updates ? 'ec1_phone'                    THEN (p_updates->>'ec1_phone')                    ELSE ec1_phone                    END,
    ec2_name                     = CASE WHEN p_updates ? 'ec2_name'                     THEN (p_updates->>'ec2_name')                     ELSE ec2_name                     END,
    ec2_relationship             = CASE WHEN p_updates ? 'ec2_relationship'             THEN (p_updates->>'ec2_relationship')             ELSE ec2_relationship             END,
    ec2_phone                    = CASE WHEN p_updates ? 'ec2_phone'                    THEN (p_updates->>'ec2_phone')                    ELSE ec2_phone                    END,
    send_notes                   = CASE WHEN p_updates ? 'send_notes'                   THEN (p_updates->>'send_notes')                   ELSE send_notes                   END,
    dietary_notes                = CASE WHEN p_updates ? 'dietary_notes'                THEN (p_updates->>'dietary_notes')                ELSE dietary_notes                END,
    consent_emergency_treatment  = CASE WHEN p_updates ? 'consent_emergency_treatment'  THEN (p_updates->>'consent_emergency_treatment')::boolean  ELSE consent_emergency_treatment  END,
    consent_administer_medication= CASE WHEN p_updates ? 'consent_administer_medication' THEN (p_updates->>'consent_administer_medication')::boolean ELSE consent_administer_medication END,
    may_leave_unaccompanied      = CASE WHEN p_updates ? 'may_leave_unaccompanied'      THEN (p_updates->>'may_leave_unaccompanied')::boolean      ELSE may_leave_unaccompanied      END,
    authorised_collectors        = CASE WHEN p_updates ? 'authorised_collectors'        THEN (p_updates->>'authorised_collectors')        ELSE authorised_collectors        END,
    photo_consent                = CASE WHEN p_updates ? 'photo_consent'                THEN (p_updates->'photo_consent')                ELSE photo_consent                END,
    medical_conditions           = CASE WHEN p_updates ? 'medical_conditions'           THEN (p_updates->>'medical_conditions')           ELSE medical_conditions           END,
    allergies                    = CASE WHEN p_updates ? 'allergies'                    THEN (p_updates->>'allergies')                    ELSE allergies                    END,
    medications                  = CASE WHEN p_updates ? 'medications'                  THEN (p_updates->>'medications')                  ELSE medications                  END,
    gp_details                   = CASE WHEN p_updates ? 'gp_details'                  THEN (p_updates->>'gp_details')                  ELSE gp_details                   END,
    updated_at                   = now()
  WHERE auth_user_id = v_user_id;

  -- Audit log — always for standard fields; mandatory for medical (special-category)
  INSERT INTO audit_events (team_id, actor_id, event_type, payload)
  VALUES (
    NULL,
    v_user_id,
    CASE WHEN v_medical THEN 'member_profile_medical_updated' ELSE 'member_profile_updated' END,
    jsonb_build_object(
      'profile_id',     v_profile.id,
      'fields_updated', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_updates) k),
      'medical',        v_medical
    )
  );

  -- Return the full updated profile (same shape as member_get_self)
  SELECT * INTO v_profile FROM member_profiles WHERE auth_user_id = v_user_id LIMIT 1;

  RETURN jsonb_build_object(
    'found',                          true,
    'id',                             v_profile.id,
    'first_name',                     v_profile.first_name,
    'last_name',                      v_profile.last_name,
    'email',                          v_profile.email,
    'phone',                          v_profile.phone,
    'dob',                            v_profile.dob,
    'gender',                         v_profile.gender,
    'address_line1',                  v_profile.address_line1,
    'address_line2',                  v_profile.address_line2,
    'address_city',                   v_profile.address_city,
    'address_postcode',               v_profile.address_postcode,
    'ec1_name',                       v_profile.ec1_name,
    'ec1_relationship',               v_profile.ec1_relationship,
    'ec1_phone',                      v_profile.ec1_phone,
    'ec2_name',                       v_profile.ec2_name,
    'ec2_relationship',               v_profile.ec2_relationship,
    'ec2_phone',                      v_profile.ec2_phone,
    'send_notes',                     v_profile.send_notes,
    'dietary_notes',                  v_profile.dietary_notes,
    'consent_emergency_treatment',    v_profile.consent_emergency_treatment,
    'consent_administer_medication',  v_profile.consent_administer_medication,
    'may_leave_unaccompanied',        v_profile.may_leave_unaccompanied,
    'authorised_collectors',          v_profile.authorised_collectors,
    'photo_consent',                  v_profile.photo_consent,
    'medical_conditions',             v_profile.medical_conditions,
    'allergies',                      v_profile.allergies,
    'medications',                    v_profile.medications,
    'gp_details',                     v_profile.gp_details,
    'created_at',                     v_profile.created_at,
    'updated_at',                     v_profile.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_update_self(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_update_self(jsonb) TO authenticated;

-- ─── get_member_pass — add member_profile_id to response ─────────────────────
-- Adds `member_profile_id` from venue_memberships so MemberPass can detect
-- whether the logged-in user is the account-holder (compare to memberGetSelf id).

CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v jsonb; v_m record; v_offers jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT m.id, m.venue_id, m.tier_id, m.member_profile_id INTO v_m
  FROM public.venue_memberships m WHERE m.pass_token=p_token AND m.status<>'cancelled';
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
    'member_profile_id', m.member_profile_id,
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
