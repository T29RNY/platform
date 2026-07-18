-- 606_pav_multi_hat_persona_down.sql — reverses 606.
DO $$
DECLARE
  v_pav  uuid;
  v_team uuid;
  v_zora uuid := 'a5040000-0000-4000-8000-000000000099';
BEGIN
  SELECT mp.id INTO v_pav FROM public.member_profiles mp JOIN auth.users u ON u.id = mp.auth_user_id
  WHERE lower(u.email) = 'pav_somal@yahoo.com';
  SELECT id INTO v_team FROM public.club_teams WHERE name = 'U7 Dortmund' AND club_id = 'club_pa_sports';

  DELETE FROM public.club_team_managers WHERE team_id = v_team AND member_profile_id = v_pav AND role = 'manager';
  DELETE FROM public.member_guardians   WHERE child_profile_id = v_zora;
  DELETE FROM public.venue_memberships  WHERE member_profile_id = v_zora;
  DELETE FROM public.club_team_members  WHERE member_profile_id = v_zora;
  DELETE FROM public.member_profiles    WHERE id = v_zora;
END $$;
