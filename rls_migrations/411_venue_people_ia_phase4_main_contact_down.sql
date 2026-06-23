-- 411_venue_people_ia_phase4_main_contact_down.sql
-- Reverse of 411: drop the contacts table + write RPC + helper, restore both team
-- readers to their pre-411 bodies (mig 409 / mig 114), and restore
-- venue_assign_team_manager to its mig-305 body (members-only guard).

DROP FUNCTION IF EXISTS public.venue_set_team_main_contact(text, text, text, text, uuid);

-- restore venue_list_active_teams (mig 114 body)
CREATE OR REPLACE FUNCTION public.venue_list_active_teams(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_caller record; v_venue_id text; v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', t.id, 'name', t.name, 'primary_colour', t.primary_colour,
    'secondary_colour', t.secondary_colour, 'competition_count', t.comp_count,
    'last_active_at', t.last_seen) ORDER BY t.name), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT te.id, te.name, te.primary_colour, te.secondary_colour,
           count(DISTINCT ct.competition_id) AS comp_count, max(ct.registered_at) AS last_seen
    FROM teams te
    JOIN competition_teams ct ON ct.team_id = te.id
    JOIN competitions c ON c.id = ct.competition_id
    JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE l.venue_id = v_venue_id AND ct.status IN ('active','pending') AND te.team_type = 'competitive'
    GROUP BY te.id, te.name, te.primary_colour, te.secondary_colour
  ) t;
  RETURN v_result;
END; $function$;
REVOKE ALL ON FUNCTION public.venue_list_active_teams(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_active_teams(text) TO anon, authenticated;

-- restore venue_list_club_teams (mig 409 body)
CREATE OR REPLACE FUNCTION public.venue_list_club_teams(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_caller record; v_venue_id text; v_teams jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', ct.id, 'club_id', ct.club_id, 'club_name', cl.name,
    'cohort_id', ct.cohort_id, 'cohort_name', cc.name, 'cohort_category', cc.category,
    'name', ct.name, 'gender', ct.gender, 'priority_rank', ct.priority_rank,
    'member_count', (SELECT count(*) FROM public.club_team_members m WHERE m.team_id = ct.id AND COALESCE(m.is_active, true)),
    'created_at', ct.created_at
  ) ORDER BY cl.name, cc.name, ct.priority_rank NULLS LAST, ct.name), '[]'::jsonb)
  INTO v_teams
  FROM public.club_venues cv
  JOIN public.clubs cl ON cl.id = cv.club_id
  JOIN public.club_teams ct ON ct.club_id = cv.club_id
  JOIN public.club_cohorts cc ON cc.id = ct.cohort_id
  WHERE cv.venue_id = v_venue_id AND ct.archived_at IS NULL;
  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END; $function$;
REVOKE ALL ON FUNCTION public.venue_list_club_teams(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_club_teams(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public._venue_team_contact_json(text, text, text, text);
DROP TABLE IF EXISTS public.venue_team_contacts;

-- restore venue_assign_team_manager (mig 305 body — members-only guard)
CREATE OR REPLACE FUNCTION public.venue_assign_team_manager(
  p_token text, p_team_id uuid, p_member_profile_id uuid, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_club_id text; v_manager_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_role NOT IN ('manager','assistant_manager','coach') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='P0001';
  END IF;
  SELECT ct.club_id INTO v_club_id
  FROM public.club_teams ct JOIN public.club_venues cv ON cv.club_id = ct.club_id
  WHERE ct.id = p_team_id AND cv.venue_id = v_venue_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE member_profile_id = p_member_profile_id AND club_id = v_club_id AND status IN ('active','ending')
  ) THEN RAISE EXCEPTION 'member_not_enrolled' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.club_team_managers (team_id, member_profile_id, role, is_active)
  VALUES (p_team_id, p_member_profile_id, p_role, true)
  ON CONFLICT (team_id, member_profile_id) DO UPDATE SET role = p_role, is_active = true, assigned_at = now()
  RETURNING id INTO v_manager_id;
  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'staff_assigned', 'club_team_manager', v_manager_id::text,
          jsonb_build_object('team_id', p_team_id, 'member_profile_id', p_member_profile_id, 'role', p_role));
  RETURN jsonb_build_object('ok', true, 'manager_id', v_manager_id);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_assign_team_manager(text, uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_assign_team_manager(text, uuid, uuid, text) TO anon, authenticated;
