-- 443 DOWN — referee tournament officiating.
-- Restores the pre-443 bodies of the three REPLACED functions (so nothing references the
-- dropped reader), reverts the response CHECK, drops the two new functions, and undoes the
-- demo seed (re-assign the live final to its prior official, delete the 3rd-place play-off).

-- get_my_world — restore mig-373 body (v_ref = league+casual only).
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

  v_ref := COALESCE(public.get_my_assignments(NULL) -> 'games', '[]'::jsonb);

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

-- club_admin_get_schedule — restore pre-443 body (no venue_officials / official fields).
CREATE OR REPLACE FUNCTION public.club_admin_get_schedule(
  p_tournament_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_venue_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id, venue_id INTO v_club_id, v_venue_id
  FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers ctm
    JOIN public.club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'tournament_event_id', p_tournament_event_id,
    'venue_playing_areas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',   pa.id,
        'name', pa.name
      ) ORDER BY pa.sort_order, pa.name)
      FROM playing_areas pa
      WHERE pa.venue_id = v_venue_id AND pa.active = true
    ), '[]'::jsonb),
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'competition_id',  comp.id,
        'name',            comp.name,
        'type',            comp.type,
        'format',          comp.format,
        'status',          comp.status,
        'knockout_seeded', COALESCE((comp.config->>'knockout_seeded')::boolean, false),
        'fixtures', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'fixture_id',      fx.id,
            'round',           fx.week_number,
            'round_name',      fx.round_name,
            'group_label',     fx.group_label,
            'de_bracket',      fx.de_bracket,
            'home_team_id',    fx.home_competition_team_id,
            'home_team_name',  ht.team_name,
            'away_team_id',    fx.away_competition_team_id,
            'away_team_name',  att.team_name,
            'scheduled_date',  fx.scheduled_date,
            'kickoff_time',    fx.kickoff_time,
            'playing_area_id', fx.playing_area_id,
            'pitch_name',      pa.name,
            'slot_minutes',    fx.slot_minutes,
            'status',          fx.status,
            'ref_token',       fx.ref_token,
            'home_score',      fx.home_score,
            'away_score',      fx.away_score
          ) ORDER BY fx.week_number, fx.kickoff_time NULLS LAST, fx.id)
          FROM fixtures fx
          LEFT JOIN competition_teams ht  ON ht.id  = fx.home_competition_team_id
          LEFT JOIN competition_teams att ON att.id = fx.away_competition_team_id
          LEFT JOIN playing_areas pa      ON pa.id  = fx.playing_area_id
          WHERE fx.competition_id = comp.id
        ), '[]'::jsonb)
      ) ORDER BY comp.name)
      FROM competitions comp
      WHERE comp.tournament_event_id = p_tournament_event_id
    ), '[]'::jsonb)
  );
END;
$function$;

-- ref_respond_to_assignment — restore mig-442 body (league/casual only).
CREATE OR REPLACE FUNCTION public.ref_respond_to_assignment(
  p_context  text,
  p_game_id  text,
  p_response text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_person  uuid;
  v_team_id text;
  v_entity  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_context NOT IN ('league', 'casual') THEN
    RAISE EXCEPTION 'invalid_context' USING ERRCODE = 'P0001';
  END IF;
  IF p_response NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'invalid_response' USING ERRCODE = 'P0001';
  END IF;
  IF p_game_id IS NULL THEN
    RAISE EXCEPTION 'game_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person FROM public.people WHERE auth_user_id = v_uid;
  IF v_person IS NULL THEN
    RAISE EXCEPTION 'no_person' USING ERRCODE = 'P0001';
  END IF;

  IF p_context = 'league' THEN
    SELECT mo.venue_id, 'fixture'
      INTO v_team_id, v_entity
      FROM public.fixtures f
      JOIN public.match_officials mo ON mo.id = f.official_id AND mo.person_id = v_person
     WHERE f.id::text = p_game_id
       AND f.status IN ('scheduled', 'allocated', 'in_progress');
  ELSE
    SELECT m.team_id, 'match'
      INTO v_team_id, v_entity
      FROM public.matches m
      JOIN public.players p ON p.id = m.ref_player_id AND p.person_id = v_person
     WHERE m.id = p_game_id
       AND m.winner IS NULL
       AND COALESCE(m.cancelled, false) = false;
  END IF;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'not_your_assignment' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ref_assignment_responses (context, game_id, person_id, response, responded_at)
  VALUES (p_context, p_game_id, v_person, p_response, now())
  ON CONFLICT (context, game_id, person_id)
  DO UPDATE SET response = EXCLUDED.response, responded_at = now();

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_uid, 'referee', 'auth_user:' || v_uid::text,
    'ref_assignment_' || p_response, v_entity, p_game_id,
    jsonb_build_object('context', p_context, 'person_id', v_person, 'response', p_response)
  );

  RETURN jsonb_build_object('ok', true, 'context', p_context, 'game_id', p_game_id, 'response', p_response);
END;
$function$;

ALTER TABLE public.ref_assignment_responses
  DROP CONSTRAINT IF EXISTS ref_assignment_responses_context_check;
ALTER TABLE public.ref_assignment_responses
  ADD CONSTRAINT ref_assignment_responses_context_check
  CHECK (context IN ('league', 'casual'));

DROP FUNCTION IF EXISTS public.club_admin_assign_tournament_ref(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_my_tournament_assignments();

-- Undo demo seed.
DELETE FROM public.fixtures WHERE id = '70000000-0000-4000-8000-000000000404';
UPDATE public.fixtures
   SET official_id = '70000000-0000-4000-8000-000000000603'
 WHERE id = '70000000-0000-4000-8000-000000000403';

SELECT pg_notify('pgrst', 'reload schema');
