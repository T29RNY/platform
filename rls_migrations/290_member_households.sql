-- Migration 290 — Phase 3: Households / child memberships
-- Delivers: member_register_child, member_list_children, member_update_child
-- No schema changes needed — member_guardians already has all required columns.
-- Invite flow deferred; second guardian stored as data fields on child profile.

-- ─── member_register_child ────────────────────────────────────────────────────

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

  INSERT INTO audit_events (team_id, actor_id, event_type, payload)
  VALUES (
    NULL,
    v_user_id,
    'member_child_registered',
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

-- ─── member_list_children ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_list_children()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_caller_profile uuid;
  v_result         jsonb;
BEGIN
  SELECT id INTO v_caller_profile
  FROM member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('children', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           mp.id,
    'first_name',   mp.first_name,
    'last_name',    mp.last_name,
    'dob',          mp.dob,
    'is_primary',   mg.is_primary,
    'can_collect',  mg.can_collect,
    'relationship', mg.relationship
  ) ORDER BY mp.first_name), '[]'::jsonb)
  INTO v_result
  FROM member_guardians mg
  JOIN member_profiles mp ON mp.id = mg.child_profile_id
  WHERE mg.guardian_profile_id = v_caller_profile
    AND mg.invite_state = 'accepted';

  RETURN jsonb_build_object('children', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.member_list_children() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_list_children() TO authenticated;

-- ─── member_update_child ──────────────────────────────────────────────────────

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

  INSERT INTO audit_events (team_id, actor_id, event_type, payload)
  VALUES (
    NULL,
    v_user_id,
    CASE WHEN v_medical THEN 'member_child_medical_updated' ELSE 'member_child_profile_updated' END,
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
