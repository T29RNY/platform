-- Down migration 352 — restore the pre-352 (mig-314) body of get_user_relationships.
-- NOTE: the pre-352 body contains the p.team_id / p.player_token bug this migration
-- fixes, so reverting re-introduces the 400 on app load. Provided only for strict
-- reversibility.
CREATE OR REPLACE FUNCTION public.get_user_relationships()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_squads     jsonb;
  v_clubs      jsonb;
  v_guardian   jsonb;
  v_comps      jsonb;
  v_admin      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id',      t.id,
    'name',         t.name,
    'player_token', p.player_token,
    'game_date_time', s.game_date_time,
    'game_is_live', s.game_is_live
  ) ORDER BY s.game_date_time NULLS LAST), '[]'::jsonb)
  INTO v_squads
  FROM players p
  JOIN teams t ON t.id = p.team_id
  LEFT JOIN schedule s ON s.team_id = p.team_id
  WHERE p.user_id = v_uid
    AND p.disabled = false;

  SELECT id INTO v_profile_id
  FROM member_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'squads',           v_squads,
      'club_memberships', '[]'::jsonb,
      'guardian_of',      '[]'::jsonb,
      'competitions',     '[]'::jsonb,
      'admin_roles',      '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id', c.id, 'name', c.name, 'cohort_id', vm.cohort_id, 'cohort_name', cc.name
  ) ORDER BY c.name, cc.name NULLS LAST), '[]'::jsonb)
  INTO v_clubs
  FROM venue_memberships vm
  JOIN clubs c ON c.id = vm.club_id
  LEFT JOIN club_cohorts cc ON cc.id = vm.cohort_id
  WHERE vm.member_profile_id = v_profile_id AND vm.status IN ('active', 'ending');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_profile_id', mp.id, 'first_name', mp.first_name, 'last_name', mp.last_name
  ) ORDER BY mp.first_name), '[]'::jsonb)
  INTO v_guardian
  FROM member_guardians mg
  JOIN member_profiles mp ON mp.id = mg.child_profile_id
  WHERE mg.guardian_profile_id = v_profile_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'competition_id', c.id, 'name', c.name, 'team_id', pr.team_id, 'status', pr.status
  ) ORDER BY c.id), '[]'::jsonb)
  INTO v_comps
  FROM player_registrations pr
  JOIN players p ON p.id = pr.player_id
  JOIN competitions c ON c.id = pr.competition_id
  WHERE p.user_id = v_uid AND pr.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type', 'club_admin', 'entity_id', ct.club_id, 'team_id', ct.id, 'role', ctm.role
  ) ORDER BY ct.club_id), '[]'::jsonb)
  INTO v_admin
  FROM club_team_managers ctm
  JOIN club_teams ct ON ct.id = ctm.team_id
  WHERE ctm.member_profile_id = v_profile_id AND ctm.is_active = true;

  RETURN jsonb_build_object(
    'squads', v_squads, 'club_memberships', v_clubs, 'guardian_of', v_guardian,
    'competitions', v_comps, 'admin_roles', v_admin
  );
END;
$function$;
