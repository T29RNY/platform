-- 570_member_rpc_audit_column_fix.sql
-- Fix three member RPCs that INSERT into non-existent audit_events columns
-- (team_id, actor_id, event_type, payload). The real audit_events columns are
-- (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type,
--  entity_id, metadata) — see 003_audit_events.sql. Because the bad INSERT is
-- in the same transaction as the write, every call throws undefined_column
-- (42703) and rolls the whole operation back.
--
--   • member_update_self   — LIVE-WIRED (MemberProfile "Save my own profile":
--                            name/address/emergency/medical/photo-consent).
--                            100% broken today; the member/guardian self-edit
--                            path silently loses every save.
--   • member_create_profile — orphaned (no UI caller today) but carries the
--                            same latent bug; fixed here so it is safe if wired.
--   • member_claim_profile  — orphaned; same latent bug; fixed here.
--
-- Sibling member RPCs were fixed for this exact bug in migs 295/297; these three
-- were missed. Only the audit INSERT changes in each — write logic is unchanged.
-- Go-live-check (player + guardian onboarding), 2026-07-13.

-- ── member_update_self ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_update_self(p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Audit log — always for standard fields; mandatory for medical (special-category).
  -- Correct audit_events column set (was: team_id, actor_id, event_type, payload).
  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system',
    v_user_id,
    'player',
    v_profile.id::text,
    CASE WHEN v_medical THEN 'member_profile_medical_updated' ELSE 'member_profile_updated' END,
    'member_profile',
    v_profile.id::text,
    jsonb_build_object(
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
$function$;

-- ── member_create_profile ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_create_profile(p_venue_id text, p_first_name text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_dob date DEFAULT NULL::date, p_phone text DEFAULT NULL::text, p_source_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id   uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM venue_admins
    WHERE venue_id = p_venue_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO member_profiles (
    first_name, last_name, email, dob, phone, source_customer_id
  )
  VALUES (
    p_first_name, p_last_name, p_email, p_dob, p_phone, p_source_customer_id
  )
  RETURNING id INTO v_profile_id;

  -- Correct audit_events column set (was: team_id, actor_id, event_type, payload).
  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    p_venue_id,
    v_user_id,
    'venue_admin',
    v_user_id::text,
    'member_profile_created',
    'member_profile',
    v_profile_id::text,
    jsonb_build_object('email', p_email)
  );

  RETURN jsonb_build_object('profile_id', v_profile_id);
END;
$function$;

-- ── member_claim_profile ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_claim_profile(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id      uuid := auth.uid();
  v_caller_email text;
  v_profile      record;
BEGIN
  SELECT id, auth_user_id, email, first_name, last_name
  INTO v_profile
  FROM member_profiles
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_profile.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'profile_already_claimed';
  END IF;

  SELECT email INTO v_caller_email
  FROM auth.users
  WHERE id = v_user_id;

  IF lower(v_caller_email) != lower(v_profile.email) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  UPDATE member_profiles
  SET auth_user_id = v_user_id,
      updated_at   = now()
  WHERE id = p_profile_id;

  -- Correct audit_events column set (was: team_id, actor_id, event_type, payload).
  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    '_system',
    v_user_id,
    'player',
    v_user_id::text,
    'member_profile_claimed',
    'member_profile',
    p_profile_id::text,
    jsonb_build_object('profile_id', p_profile_id)
  );

  RETURN jsonb_build_object(
    'profile_id',  v_profile.id,
    'first_name',  v_profile.first_name,
    'last_name',   v_profile.last_name
  );
END;
$function$;
