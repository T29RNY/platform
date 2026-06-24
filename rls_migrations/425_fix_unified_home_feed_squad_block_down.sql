-- 425 DOWN: restore the pre-425 get_unified_home_feed definition.
-- NOTE: the prior squad block is the BUGGY one (references p.team_id /
-- p.player_token which do not exist, and keys off players.team instead of
-- team_players) — restoring it re-breaks the feed RPC (42703). This down
-- exists only as a faithful revert of migration 425.
CREATE OR REPLACE FUNCTION public.get_unified_home_feed()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_horizon    timestamptz := now() + interval '14 days';
  v_events     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id
  FROM member_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(e.row ORDER BY (e.row->>'when_at') NULLS LAST),
    '[]'::jsonb
  )
  INTO v_events
  FROM (
    SELECT jsonb_build_object(
      'type',         'squad_game',
      'title',        t.name,
      'subtitle',     COALESCE(s.venue, ''),
      'when_at',      s.game_date_time,
      'entity_id',    p.player_token,
      'entity_type',  'squad',
      'is_live',      s.game_is_live
    ) AS row
    FROM players p
    JOIN teams t ON t.id = p.team_id
    JOIN schedule s ON s.team_id = p.team_id
    WHERE p.user_id = v_uid
      AND p.disabled = false
      AND s.game_date_time IS NOT NULL
      AND s.game_date_time < v_horizon
      AND s.game_is_live = false

    UNION ALL

    SELECT jsonb_build_object(
      'type',         'club_session',
      'title',        cs.title,
      'subtitle',     COALESCE(cs.location, ''),
      'when_at',      cs.scheduled_at,
      'entity_id',    cs.id::text,
      'entity_type',  'club_session',
      'own_rsvp',     r.status
    ) AS row
    FROM venue_memberships vm
    JOIN club_sessions cs ON cs.club_id = vm.club_id
    LEFT JOIN club_session_rsvps r
           ON r.session_id = cs.id AND r.member_profile_id = v_profile_id
    WHERE vm.member_profile_id = v_profile_id
      AND vm.status IN ('active', 'ending')
      AND cs.status = 'scheduled'
      AND cs.scheduled_at > now()
      AND cs.scheduled_at < v_horizon

    UNION ALL

    SELECT jsonb_build_object(
      'type',        'competition_fixture',
      'title',       CASE
                       WHEN f.home_team_id = pr.team_id
                         THEN ht.name || ' vs ' || COALESCE(at.name, 'BYE')
                       ELSE COALESCE(ht.name, 'BYE') || ' vs ' || at.name
                     END,
      'subtitle',    comp.name,
      'when_at',     f.scheduled_date::timestamptz,
      'entity_id',   f.id::text,
      'entity_type', 'fixture'
    ) AS row
    FROM player_registrations pr
    JOIN players p ON p.id = pr.player_id
    JOIN fixtures f ON f.home_team_id = pr.team_id OR f.away_team_id = pr.team_id
    JOIN competitions comp ON comp.id = f.competition_id
    LEFT JOIN teams ht ON ht.id = f.home_team_id
    LEFT JOIN teams at ON at.id = f.away_team_id
    WHERE p.user_id = v_uid
      AND pr.status = 'active'
      AND f.status IN ('scheduled', 'allocated')
      AND f.scheduled_date >= current_date
      AND f.scheduled_date::timestamptz < v_horizon

    UNION ALL

    SELECT jsonb_build_object(
      'type',             'child_event',
      'title',            child.first_name || '''s session',
      'subtitle',         cs.title,
      'when_at',          cs.scheduled_at,
      'entity_id',        cs.id::text,
      'entity_type',      'club_session',
      'child_name',       child.first_name,
      'child_profile_id', child.id::text
    ) AS row
    FROM member_guardians mg
    JOIN member_profiles child ON child.id = mg.child_profile_id
    JOIN venue_memberships vm2 ON vm2.member_profile_id = child.id
      AND vm2.status IN ('active', 'ending')
    JOIN club_sessions cs ON cs.club_id = vm2.club_id
    WHERE mg.guardian_profile_id = v_profile_id
      AND cs.status = 'scheduled'
      AND cs.scheduled_at > now()
      AND cs.scheduled_at < v_horizon
  ) e
  LIMIT 30;

  RETURN jsonb_build_object('events', v_events);
END;
$function$;
