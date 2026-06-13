-- Migration 287 — Member RPCs: Phase 1 member-facing API
-- member_create_profile: venue admin creates an unclaimed profile
-- member_claim_profile:  authenticated member claims a profile by verified-email match
-- member_get_self:       authenticated member reads their own profile
-- All SECURITY DEFINER, search_path locked, authenticated-only.
-- Negative-path guards documented inline — proven by ephemeral-verify.

-- ─── member_create_profile ───────────────────────────────────────────────────
-- Venue admin creates a member_profiles row (auth_user_id = NULL = unclaimed).
-- Used during migration from venue_customers and at the /q signup entry point.
-- Caller must have a venue_admins row for p_venue_id (auth via auth.uid()).
-- Inserts audit_events per Hard Rule 9.

CREATE OR REPLACE FUNCTION public.member_create_profile(
  p_venue_id          text,
  p_first_name        text,
  p_last_name         text        DEFAULT NULL,
  p_email             text        DEFAULT NULL,
  p_dob               date        DEFAULT NULL,
  p_phone             text        DEFAULT NULL,
  p_source_customer_id uuid       DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  -- Caller must be a venue admin
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

  INSERT INTO audit_events (team_id, actor_id, event_type, payload)
  VALUES (
    p_venue_id,
    v_user_id,
    'member_profile_created',
    jsonb_build_object(
      'profile_id', v_profile_id,
      'email',      p_email
    )
  );

  RETURN jsonb_build_object('profile_id', v_profile_id);
END;
$$;

REVOKE ALL ON FUNCTION public.member_create_profile(text, text, text, text, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_create_profile(text, text, text, text, date, text, uuid) TO authenticated;

-- ─── member_claim_profile ────────────────────────────────────────────────────
-- An authenticated member links their auth account to an unclaimed profile.
-- Guards (negative-path EV must prove each rejection path):
--   1. Profile not found → error
--   2. Profile already claimed (auth_user_id NOT NULL) → error
--   3. auth.users email != profile.email → error (verified-email match only)
-- One-time: once claimed, the profile is permanently bound to auth.uid().
-- Inserts audit_events per Hard Rule 9.

CREATE OR REPLACE FUNCTION public.member_claim_profile(
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_caller_email text;
  v_profile      record;
BEGIN
  -- Fetch profile (existence check)
  SELECT id, auth_user_id, email, first_name, last_name
  INTO v_profile
  FROM member_profiles
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- Guard: already claimed
  IF v_profile.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'profile_already_claimed';
  END IF;

  -- Fetch caller's verified email from auth.users
  SELECT email INTO v_caller_email
  FROM auth.users
  WHERE id = v_user_id;

  -- Guard: email must match (case-insensitive)
  IF lower(v_caller_email) != lower(v_profile.email) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  -- Claim the profile
  UPDATE member_profiles
  SET auth_user_id = v_user_id,
      updated_at   = now()
  WHERE id = p_profile_id;

  INSERT INTO audit_events (team_id, actor_id, event_type, payload)
  VALUES (
    NULL,
    v_user_id,
    'member_profile_claimed',
    jsonb_build_object('profile_id', p_profile_id)
  );

  RETURN jsonb_build_object(
    'profile_id',  v_profile.id,
    'first_name',  v_profile.first_name,
    'last_name',   v_profile.last_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_claim_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_claim_profile(uuid) TO authenticated;

-- ─── member_get_self ─────────────────────────────────────────────────────────
-- Authenticated member reads their own profile.
-- Scoped entirely to auth.uid() — no passed profile_id, zero horizontal-access risk.
-- Returns {found: false} when no profile is linked yet (not an error).

CREATE OR REPLACE FUNCTION public.member_get_self()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
BEGIN
  SELECT * INTO v_profile
  FROM member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

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
    'created_at',                     v_profile.created_at,
    'updated_at',                     v_profile.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_get_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_get_self() TO authenticated;
