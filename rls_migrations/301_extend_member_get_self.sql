-- Migration 301 — Extend member_get_self with active_clubs + managed_teams
-- active_clubs: all clubs where this member has an active/ending membership,
--   one row per (club, cohort) — a parent with two children in different cohorts
--   at the same club gets two entries.
-- managed_teams: all teams where this member is an active manager/coach via
--   club_team_managers. Used by SessionsScreen to unlock write options.
-- Signature unchanged (no DROP needed — same () → jsonb overload).

CREATE OR REPLACE FUNCTION public.member_get_self()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_profile          record;
  v_id_mandate_clubs jsonb;
  v_active_clubs     jsonb;
  v_managed_teams    jsonb;
BEGIN
  SELECT * INTO v_profile
  FROM member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Clubs requiring ID verification (existing field, unchanged logic)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',   c.id,
    'club_name', c.name
  )), '[]'::jsonb)
  INTO v_id_mandate_clubs
  FROM venue_memberships vm
  JOIN clubs c ON c.id = vm.club_id
  WHERE vm.member_profile_id = v_profile.id
    AND vm.status = 'active'
    AND c.id_mandate = true;

  -- All active/ending memberships — one row per (club, cohort)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',     c.id,
    'club_name',   c.name,
    'cohort_id',   vm.cohort_id,
    'cohort_name', cc.name
  ) ORDER BY c.name, cc.name), '[]'::jsonb)
  INTO v_active_clubs
  FROM venue_memberships vm
  JOIN clubs c ON c.id = vm.club_id
  LEFT JOIN club_cohorts cc ON cc.id = vm.cohort_id
  WHERE vm.member_profile_id = v_profile.id
    AND vm.status IN ('active', 'ending');

  -- Teams where this member is an active manager/coach
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id',   ct.id,
    'team_name', ct.name,
    'club_id',   ct.club_id,
    'role',      ctm.role
  ) ORDER BY ct.name), '[]'::jsonb)
  INTO v_managed_teams
  FROM club_team_managers ctm
  JOIN club_teams ct ON ct.id = ctm.team_id
  WHERE ctm.member_profile_id = v_profile.id
    AND ctm.is_active = true;

  RETURN jsonb_build_object(
    'found',                          true,
    'id',                             v_profile.id,
    'member_profile_id',              v_profile.id,
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
    'updated_at',                     v_profile.updated_at,
    'id_mandate_clubs',               v_id_mandate_clubs,
    'active_clubs',                   v_active_clubs,
    'managed_teams',                  v_managed_teams
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_get_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_get_self() TO authenticated;
