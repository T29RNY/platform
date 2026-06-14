-- Migration 306: Phase 12 — Cohort-scoped member visibility
-- 1. club_manager_get_team_members: adds has_medical_notes bool to each row
-- 2. club_manager_get_member_detail: new RPC with two-tier scope check
--    Tier 1 (role='manager' on any team in the club) → all club members
--    Tier 2 (coach/assistant_manager) → own team members only

-- ─── 1. club_manager_get_team_members (CREATE OR REPLACE — same signature) ──

CREATE OR REPLACE FUNCTION public.club_manager_get_team_members(
  p_team_id   uuid,
  p_session_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile_id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'profile_id',        mp.id,
        'first_name',        mp.first_name,
        'last_name',         mp.last_name,
        'is_session_guest',  CASE
          WHEN p_session_id IS NOT NULL THEN EXISTS (
            SELECT 1 FROM public.club_session_guests csg
            WHERE csg.session_id = p_session_id AND csg.member_profile_id = mp.id
          )
          ELSE false
        END,
        'has_medical_notes', (
          mp.medical_conditions IS NOT NULL OR
          mp.allergies          IS NOT NULL OR
          mp.medications        IS NOT NULL OR
          mp.gp_details         IS NOT NULL
        )
      ) ORDER BY mp.first_name, mp.last_name
    )
    FROM public.club_team_members ctm
    JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
    WHERE ctm.team_id = p_team_id AND ctm.is_active = true
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_get_team_members(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_get_team_members(uuid, uuid) TO authenticated;

-- ─── 2. club_manager_get_member_detail ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_manager_get_member_detail(
  p_member_profile_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_target     record;
  v_guardian   record;
  v_club_id    text;
  v_authorised boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  -- Load target member
  SELECT * INTO v_target FROM public.member_profiles WHERE id = p_member_profile_id;
  IF v_target IS NULL THEN RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0001'; END IF;

  -- Resolve the target's club (first active team membership)
  SELECT ct.club_id INTO v_club_id
  FROM public.club_team_members ctm
  JOIN public.club_teams ct ON ct.id = ctm.team_id
  WHERE ctm.member_profile_id = p_member_profile_id AND ctm.is_active = true
  LIMIT 1;

  IF v_club_id IS NOT NULL THEN
    -- Tier 1: caller is a 'manager' on any active team in that club
    IF EXISTS (
      SELECT 1 FROM public.club_team_managers ctm2
      JOIN public.club_teams ct2 ON ct2.id = ctm2.team_id
      WHERE ctm2.member_profile_id = v_profile_id
        AND ctm2.is_active = true
        AND ctm2.role = 'manager'
        AND ct2.club_id = v_club_id
    ) THEN
      v_authorised := true;
    END IF;

    -- Tier 2: caller is a coach/assistant_manager on a team the target also belongs to
    IF NOT v_authorised AND EXISTS (
      SELECT 1 FROM public.club_team_managers ctm_caller
      JOIN public.club_team_members ctm_target
        ON ctm_target.team_id = ctm_caller.team_id
       AND ctm_target.member_profile_id = p_member_profile_id
       AND ctm_target.is_active = true
      WHERE ctm_caller.member_profile_id = v_profile_id
        AND ctm_caller.is_active = true
    ) THEN
      v_authorised := true;
    END IF;
  END IF;

  IF NOT v_authorised THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Load first guardian (if target is a child)
  SELECT mp.first_name, mp.last_name, mp.phone INTO v_guardian
  FROM public.member_guardians mg
  JOIN public.member_profiles mp ON mp.id = mg.guardian_profile_id
  WHERE mg.child_profile_id = p_member_profile_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'profile_id',                    v_target.id,
    'first_name',                    v_target.first_name,
    'last_name',                     v_target.last_name,
    'dob',                           v_target.dob,
    'ec1_name',                      v_target.ec1_name,
    'ec1_relationship',              v_target.ec1_relationship,
    'ec1_phone',                     v_target.ec1_phone,
    'ec2_name',                      v_target.ec2_name,
    'ec2_relationship',              v_target.ec2_relationship,
    'ec2_phone',                     v_target.ec2_phone,
    'medical_conditions',            v_target.medical_conditions,
    'allergies',                     v_target.allergies,
    'medications',                   v_target.medications,
    'gp_details',                    v_target.gp_details,
    'send_notes',                    v_target.send_notes,
    'dietary_notes',                 v_target.dietary_notes,
    'consent_emergency_treatment',   v_target.consent_emergency_treatment,
    'consent_administer_medication', v_target.consent_administer_medication,
    'guardian_first_name',           v_guardian.first_name,
    'guardian_last_name',            v_guardian.last_name,
    'guardian_phone',                v_guardian.phone
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_get_member_detail(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_get_member_detail(uuid) TO authenticated;
