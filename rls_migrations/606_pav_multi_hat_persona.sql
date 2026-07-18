-- 606_pav_multi_hat_persona.sql
-- Demo persona (operator, 2026-07-18): Pav Somal (pav_somal@yahoo.com) should show ALL
-- hats on his one login. He is already an active OWNER of pa_peugeot + seva_school (the
-- club-owner hat). This adds the two missing hats:
--   • MANAGER of U7 Dortmund (alongside the existing coach, Nihal) → coach/manager hat.
--   • GUARDIAN of his son Zora Somal (new U7 Dortmund member, age ~6) → guardian hat.
-- Zora is created as a Junior season member (£480) of PA in the Under 7s cohort so the
-- guardian view shows a real child on a real team. Idempotent; lookups by email/name (no
-- reliance on pre-existing generated ids beyond Zora's own fixed seed id in the a5* series).

DO $$
DECLARE
  v_pav    uuid;
  v_team   uuid;
  v_cohort uuid;
  v_tier   uuid;
  v_zora   uuid := 'a5040000-0000-4000-8000-000000000099';
BEGIN
  SELECT mp.id INTO v_pav
  FROM public.member_profiles mp JOIN auth.users u ON u.id = mp.auth_user_id
  WHERE lower(u.email) = 'pav_somal@yahoo.com';
  SELECT id, cohort_id INTO v_team, v_cohort
  FROM public.club_teams WHERE name = 'U7 Dortmund' AND club_id = 'club_pa_sports';
  SELECT id INTO v_tier
  FROM public.venue_membership_tiers WHERE venue_id = 'pa_peugeot' AND name = 'Junior Membership';

  IF v_pav IS NULL OR v_team IS NULL OR v_tier IS NULL THEN
    RAISE EXCEPTION 'pav_multi_hat: missing lookup (pav=% team=% tier=%)', v_pav, v_team, v_tier;
  END IF;

  -- Zora Somal (Pav's son)
  INSERT INTO public.member_profiles (id, first_name, last_name, dob)
  VALUES (v_zora, 'Zora', 'Somal', '2019-09-01')
  ON CONFLICT (id) DO NOTHING;

  -- Pav as MANAGER of U7 Dortmund (alongside Nihal)
  IF NOT EXISTS (SELECT 1 FROM public.club_team_managers WHERE team_id = v_team AND member_profile_id = v_pav) THEN
    INSERT INTO public.club_team_managers (team_id, member_profile_id, role, is_active)
    VALUES (v_team, v_pav, 'manager', true);
  END IF;

  -- Zora on the U7 Dortmund roster
  IF NOT EXISTS (SELECT 1 FROM public.club_team_members WHERE team_id = v_team AND member_profile_id = v_zora) THEN
    INSERT INTO public.club_team_members (team_id, member_profile_id, is_active)
    VALUES (v_team, v_zora, true);
  END IF;

  -- Zora's Junior season membership (£480, active) at PA, Under 7s cohort
  IF NOT EXISTS (SELECT 1 FROM public.venue_memberships WHERE member_profile_id = v_zora AND status IN ('active','paused','ending')) THEN
    INSERT INTO public.venue_memberships (venue_id, member_profile_id, tier_id, period, amount_pence, renews_at, status, club_id, cohort_id)
    VALUES ('pa_peugeot', v_zora, v_tier, 'season', 48000, current_date + interval '1 year', 'active', 'club_pa_sports', v_cohort);
  END IF;

  -- Pav as Zora's guardian
  IF NOT EXISTS (SELECT 1 FROM public.member_guardians WHERE child_profile_id = v_zora AND guardian_profile_id = v_pav) THEN
    INSERT INTO public.member_guardians (child_profile_id, guardian_profile_id, is_primary)
    VALUES (v_zora, v_pav, true);
  END IF;
END $$;
