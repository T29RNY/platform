-- 425: fix get_unified_home_feed squad-game block (two bugs, one block)
--
--  Found session 204 via a live browser smoke of the multi-context home
--  ("Feed") screen. The screen silently showed "Nothing coming up" because
--  the RPC was throwing 42703 and the client swallowed it.
--
--  (1) Stale columns. The squad block referenced `p.team_id` and
--      `p.player_token`, but the `players` table has `team` (text) and
--      `token`. The bad refs made the WHOLE function throw 42703, so the
--      feed always returned empty for every user.
--
--  (2) Wrong membership source. Even with the columns fixed the squad block
--      keyed off `players.team`, which is NULL for linked players — squad
--      membership lives in `team_players`. Mirror the working resolution in
--      get_user_relationships (players -> team_players -> teams -> schedule).
--
--  Also adds `s.active = true` and an `> now()` lower bound so the squad
--  block matches the other three blocks' "upcoming only" semantics.
--
--  Read-only RPC; SECURITY DEFINER; search_path pinned; granted to
--  authenticated only (raises not_authenticated for anon). Return shape
--  unchanged — no JS wrapper/mapper change needed.
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
    -- Upcoming casual squad games (membership via team_players)
    SELECT jsonb_build_object(
      'type',         'squad_game',
      'title',        t.name,
      'subtitle',     COALESCE(s.venue, ''),
      'when_at',      s.game_date_time,
      'entity_id',    p.token,
      'entity_type',  'squad',
      'is_live',      s.game_is_live
    ) AS row
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
    JOIN teams t ON t.id = tp.team_id
    JOIN schedule s ON s.team_id = t.id AND s.active = true
    WHERE p.user_id = v_uid
      AND p.disabled = false
      AND s.game_date_time IS NOT NULL
      AND s.game_date_time > now()
      AND s.game_date_time < v_horizon
      AND s.game_is_live = false

    UNION ALL

    -- Upcoming club sessions (own membership)
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

    -- Upcoming competition fixtures (own registrations)
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

    -- Children's upcoming club sessions (guardian view)
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
