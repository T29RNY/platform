-- Down migration for 306_phase12_member_visibility
-- Removes club_manager_get_member_detail and reverts
-- club_manager_get_team_members to its pre-Phase-12 body (without has_medical_notes)

DROP FUNCTION IF EXISTS public.club_manager_get_member_detail(uuid);

CREATE OR REPLACE FUNCTION public.club_manager_get_team_members(
  p_team_id    uuid,
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
        'profile_id',       mp.id,
        'first_name',       mp.first_name,
        'last_name',        mp.last_name,
        'is_session_guest', CASE
          WHEN p_session_id IS NOT NULL THEN EXISTS (
            SELECT 1 FROM public.club_session_guests csg
            WHERE csg.session_id = p_session_id AND csg.member_profile_id = mp.id
          )
          ELSE false
        END
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
