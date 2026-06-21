-- 373: get_my_world — surface PAUSED club memberships (Phase 0c follow-up)
--
-- Operator feedback after the 0c switcher shipped: a paused (frozen) club
-- membership was being HIDDEN from the switcher entirely, because get_my_world's
-- club_memberships arm filtered `status IN ('active','ending')`. A paused member
-- should still SEE the club (marked paused) — they just can't act on it.
--
-- This is a one-line change to the club_memberships CTE: include 'paused'.
-- The arm already returns `status`, so the switcher can badge it. 'cancelled'
-- stays excluded (truly gone). No other arm changes; the whole function is
-- reproduced because CREATE OR REPLACE needs the full definition.
--
-- Access is enforced where it matters, NOT by hiding the row:
--   • member_book_class_session already blocks paused (status IN active/ending).
--   • MemberPass.jsx (same commit) hides the QR + check-in code for paused.
-- READ-ONLY resolver (STABLE, SECDEF, authenticated-only, anon revoked) — no EV
-- (no writes); live read-proven against the paused demo member (tarny+family).

CREATE OR REPLACE FUNCTION public.get_my_world()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_person     uuid;
  v_profile    uuid;
  v_league     jsonb;
  v_casual     jsonb;
  v_ref        jsonb;
  v_clubs      jsonb;
  v_guardian   jsonb;
  v_admin      jsonb;
  v_coach      jsonb;
  v_conflicts  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person FROM public.people WHERE auth_user_id = v_uid;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;

  -- Player — league fixtures (person → players → team_players → fixtures by team)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'fixture_id',       f.id,
    'competition_id',   f.competition_id,
    'competition_name', comp.name,
    'team_id',          myteam.team_id,
    'team_name',        tm.name,
    'opponent_name',    CASE WHEN f.home_team_id = myteam.team_id THEN awt.name ELSE hmt.name END,
    'home_away',        CASE WHEN f.home_team_id = myteam.team_id THEN 'home' ELSE 'away' END,
    'scheduled_date',   f.scheduled_date,
    'kickoff_at',       ((f.scheduled_date + COALESCE(f.kickoff_time, time '00:00')) AT TIME ZONE 'Europe/London'),
    'status',           f.status,
    'is_in_progress',   (f.status = 'in_progress'),
    'venue_name',       va.name
  ) ORDER BY f.scheduled_date, f.kickoff_time NULLS LAST), '[]'::jsonb)
  INTO v_league
  FROM (
    SELECT DISTINCT tp.team_id
    FROM public.players pl
    JOIN public.team_players tp ON tp.player_id = pl.id
    WHERE pl.person_id = v_person AND COALESCE(pl.disabled, false) = false
  ) myteam
  JOIN public.fixtures f ON (f.home_team_id = myteam.team_id OR f.away_team_id = myteam.team_id)
  JOIN public.teams tm  ON tm.id  = myteam.team_id
  JOIN public.teams hmt ON hmt.id = f.home_team_id
  LEFT JOIN public.teams awt ON awt.id = f.away_team_id
  LEFT JOIN public.competitions comp ON comp.id = f.competition_id
  LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
  LEFT JOIN public.venues va ON va.id = pa.venue_id
  WHERE f.status IN ('scheduled', 'allocated', 'in_progress')
    AND (f.status = 'in_progress' OR f.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date);

  -- Player — casual squad matches (person → players → team_players → matches by team)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'match_id',       m.id,
    'team_id',        m.team_id,
    'squad_name',     t.name,
    'kickoff_at',     s.game_date_time,
    'status',         (CASE WHEN COALESCE(s.game_is_live, false) AND m.winner IS NULL THEN 'in_progress' ELSE 'scheduled' END),
    'is_in_progress', (COALESCE(s.game_is_live, false) AND m.winner IS NULL),
    'venue_name',     s.venue
  ) ORDER BY s.game_date_time NULLS LAST), '[]'::jsonb)
  INTO v_casual
  FROM (
    SELECT DISTINCT tp.team_id
    FROM public.players pl
    JOIN public.team_players tp ON tp.player_id = pl.id
    WHERE pl.person_id = v_person AND COALESCE(pl.disabled, false) = false
  ) myteam
  JOIN public.matches m ON m.team_id = myteam.team_id
  JOIN public.teams t ON t.id = m.team_id
  LEFT JOIN public.schedule s ON s.active_match_id = m.id
  WHERE m.winner IS NULL
    AND COALESCE(m.cancelled, false) = false
    AND (
      COALESCE(s.game_is_live, false) = true
      OR (s.game_date_time IS NOT NULL
          AND s.game_date_time >= (now() AT TIME ZONE 'Europe/London')::date::timestamptz - interval '6 hours')
      OR (s.game_date_time IS NULL AND m.match_date >= (now() AT TIME ZONE 'Europe/London')::date)
    );

  -- Referee — fold both arms via the shared resolver
  v_ref := COALESCE(public.get_my_assignments(NULL) -> 'games', '[]'::jsonb);

  -- Club memberships (member profile → venue_memberships)
  -- mig 373: include 'paused' so a frozen membership is SHOWN (badged), not hidden.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',     c.id,
    'name',        c.name,
    'cohort_id',   vm.cohort_id,
    'cohort_name', cc.name,
    'status',      vm.status
  ) ORDER BY c.name, cc.name NULLS LAST), '[]'::jsonb)
  INTO v_clubs
  FROM public.venue_memberships vm
  JOIN public.clubs c ON c.id = vm.club_id
  LEFT JOIN public.club_cohorts cc ON cc.id = vm.cohort_id
  WHERE v_profile IS NOT NULL
    AND vm.member_profile_id = v_profile
    AND vm.status IN ('active', 'ending', 'paused');

  -- Guardian — each child + their upcoming cohort sessions (with this child's RSVP)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'child_profile_id', child.id,
    'first_name',       child.first_name,
    'last_name',        child.last_name,
    'sessions',         COALESCE(sess.sessions, '[]'::jsonb)
  ) ORDER BY child.first_name, child.last_name), '[]'::jsonb)
  INTO v_guardian
  FROM public.member_guardians mg
  JOIN public.member_profiles child ON child.id = mg.child_profile_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'session_id',   cs.id,
      'title',        cs.title,
      'scheduled_at', cs.scheduled_at,
      'location',     cs.location,
      'status',       cs.status,
      'rsvp_status',  r.status
    ) ORDER BY cs.scheduled_at) AS sessions
    FROM public.venue_memberships vm
    JOIN public.club_sessions cs ON cs.cohort_id = vm.cohort_id
    LEFT JOIN public.club_session_rsvps r ON r.session_id = cs.id AND r.member_profile_id = child.id
    WHERE vm.member_profile_id = child.id
      AND vm.status IN ('active', 'ending')
      AND vm.cohort_id IS NOT NULL
      AND cs.scheduled_at >= now() - interval '6 hours'
      AND COALESCE(cs.status, 'scheduled') <> 'cancelled'
  ) sess ON true
  WHERE v_profile IS NOT NULL AND mg.guardian_profile_id = v_profile;

  -- Admin roles — entity-level (team_admins + venue_admins), person-keyed
  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'type', x ->> 'entity_id'), '[]'::jsonb)
  INTO v_admin
  FROM (
    SELECT jsonb_build_object('type', 'team_admin', 'entity_id', ta.team_id, 'name', t.name, 'role', ta.role) AS x
    FROM public.team_admins ta
    JOIN public.teams t ON t.id = ta.team_id
    WHERE ta.person_id = v_person AND ta.revoked_at IS NULL
    UNION ALL
    SELECT jsonb_build_object('type', 'venue_admin', 'entity_id', va.venue_id, 'name', v.name, 'role', va.role)
    FROM public.venue_admins va
    JOIN public.venues v ON v.id = va.venue_id
    WHERE va.person_id = v_person AND va.status = 'active' AND va.revoked_at IS NULL
  ) q;

  -- Coaching / team management (club_team_managers, member-profile-keyed)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_team_id', ct.id,
    'club_id',      ct.club_id,
    'team_name',    ct.name,
    'role',         ctm.role
  ) ORDER BY ct.name), '[]'::jsonb)
  INTO v_coach
  FROM public.club_team_managers ctm
  JOIN public.club_teams ct ON ct.id = ctm.team_id
  WHERE v_profile IS NOT NULL
    AND ctm.member_profile_id = v_profile
    AND ctm.is_active = true;

  -- Conflicts — playing one game while reffing another within a 2-hour window
  WITH play AS (
    SELECT f.id::text AS game_id, 'league'::text AS ctx,
           ((f.scheduled_date + COALESCE(f.kickoff_time, time '00:00')) AT TIME ZONE 'Europe/London') AS ko
    FROM (
      SELECT DISTINCT tp.team_id FROM public.players pl
      JOIN public.team_players tp ON tp.player_id = pl.id
      WHERE pl.person_id = v_person AND COALESCE(pl.disabled, false) = false
    ) myteam
    JOIN public.fixtures f ON (f.home_team_id = myteam.team_id OR f.away_team_id = myteam.team_id)
    WHERE f.status IN ('scheduled', 'allocated', 'in_progress')
      AND (f.status = 'in_progress' OR f.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date)
    UNION ALL
    SELECT m.id, 'casual', s.game_date_time
    FROM (
      SELECT DISTINCT tp.team_id FROM public.players pl
      JOIN public.team_players tp ON tp.player_id = pl.id
      WHERE pl.person_id = v_person AND COALESCE(pl.disabled, false) = false
    ) myteam
    JOIN public.matches m ON m.team_id = myteam.team_id
    LEFT JOIN public.schedule s ON s.active_match_id = m.id
    WHERE m.winner IS NULL AND COALESCE(m.cancelled, false) = false
      AND s.game_date_time IS NOT NULL
      AND s.game_date_time >= (now() AT TIME ZONE 'Europe/London')::date::timestamptz - interval '6 hours'
  ),
  refg AS (
    SELECT (g ->> 'game_id') AS game_id, (g ->> 'context') AS ctx, (g ->> 'kickoff_at')::timestamptz AS ko
    FROM jsonb_array_elements(v_ref) g
    WHERE g ->> 'kickoff_at' IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind',         'play_vs_ref',
    'play_game_id', p.game_id,
    'play_context', p.ctx,
    'play_kickoff', p.ko,
    'ref_game_id',  r.game_id,
    'ref_context',  r.ctx,
    'ref_kickoff',  r.ko,
    'message',      'You are down to play and to referee within two hours of each other'
  ) ORDER BY p.ko), '[]'::jsonb)
  INTO v_conflicts
  FROM play p
  JOIN refg r
    ON p.game_id <> r.game_id
   AND abs(extract(epoch FROM (p.ko - r.ko))) < 7200;

  RETURN jsonb_build_object(
    'ok',               true,
    'person_id',        v_person,
    'player_fixtures',  jsonb_build_object('league', v_league, 'casual', v_casual),
    'ref_assignments',  v_ref,
    'club_memberships', v_clubs,
    'guardian_of',      v_guardian,
    'admin_roles',      v_admin,
    'coaching',         v_coach,
    'conflicts',        v_conflicts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_world() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_world() TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
