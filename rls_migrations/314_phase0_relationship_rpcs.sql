-- Migration 314 — Phase 0: Account Relationship Routing RPCs
-- Four read-only RPCs. No schema changes.
-- Auth pattern: auth.uid() → players.user_id (squads) + member_profiles.auth_user_id (club/guardian)
-- All: SECURITY DEFINER, search_path locked, authenticated only, anon revoked.

-- ─── 1. get_user_relationships() ──────────────────────────────────────────────
-- Routing oracle — called on app load to determine which home screen to render.
-- Returns all active relationships for the authenticated user.

CREATE OR REPLACE FUNCTION public.get_user_relationships()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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

  -- Squad memberships: auth.uid() → players.user_id → team
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

  -- Member profile lookup for club/guardian/admin branches
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

  -- Club memberships: active or ending venue_memberships
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',     c.id,
    'name',        c.name,
    'cohort_id',   vm.cohort_id,
    'cohort_name', cc.name
  ) ORDER BY c.name, cc.name NULLS LAST), '[]'::jsonb)
  INTO v_clubs
  FROM venue_memberships vm
  JOIN clubs c ON c.id = vm.club_id
  LEFT JOIN club_cohorts cc ON cc.id = vm.cohort_id
  WHERE vm.member_profile_id = v_profile_id
    AND vm.status IN ('active', 'ending');

  -- Guardian relationships
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_profile_id', mp.id,
    'first_name',        mp.first_name,
    'last_name',         mp.last_name
  ) ORDER BY mp.first_name), '[]'::jsonb)
  INTO v_guardian
  FROM member_guardians mg
  JOIN member_profiles mp ON mp.id = mg.child_profile_id
  WHERE mg.guardian_profile_id = v_profile_id;

  -- Competition participations via players.user_id → player_registrations
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'competition_id', c.id,
    'name',           c.name,
    'team_id',        pr.team_id,
    'status',         pr.status
  ) ORDER BY c.id), '[]'::jsonb)
  INTO v_comps
  FROM player_registrations pr
  JOIN players p ON p.id = pr.player_id
  JOIN competitions c ON c.id = pr.competition_id
  WHERE p.user_id = v_uid
    AND pr.status = 'active';

  -- Club admin roles via club_team_managers
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type',      'club_admin',
    'entity_id', ct.club_id,
    'team_id',   ct.id,
    'role',      ctm.role
  ) ORDER BY ct.club_id), '[]'::jsonb)
  INTO v_admin
  FROM club_team_managers ctm
  JOIN club_teams ct ON ct.id = ctm.team_id
  WHERE ctm.member_profile_id = v_profile_id
    AND ctm.is_active = true;

  RETURN jsonb_build_object(
    'squads',           v_squads,
    'club_memberships', v_clubs,
    'guardian_of',      v_guardian,
    'competitions',     v_comps,
    'admin_roles',      v_admin
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_relationships() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_relationships() TO authenticated;


-- ─── 2. get_unified_home_feed() ───────────────────────────────────────────────
-- Chronological events across all active relationships, next 14 days, max 30.
-- Squad players who have no club membership see only squad_game events —
-- zero new UI surfaces fire for them.

CREATE OR REPLACE FUNCTION public.get_unified_home_feed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
    -- Upcoming casual squad games
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
      AND s.game_is_live = false  -- live game shown in a separate RIGHT NOW section

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
$$;

REVOKE ALL ON FUNCTION public.get_unified_home_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unified_home_feed() TO authenticated;


-- ─── 3. get_guardian_home_feed() ──────────────────────────────────────────────
-- Parent-specific feed. Returns upcoming club sessions for each linked child.
-- Competition fixtures for children deferred to Phase 2 (most children
-- don't have auth-linked players rows in Phase 0).

CREATE OR REPLACE FUNCTION public.get_guardian_home_feed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_children   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id
  FROM member_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('children', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'profile_id', child.id,
    'first_name', child.first_name,
    'last_name',  child.last_name,
    'next_session', (
      SELECT jsonb_build_object(
        'session_id',   cs.id,
        'title',        cs.title,
        'scheduled_at', cs.scheduled_at,
        'location',     cs.location,
        'club_name',    c.name,
        'own_rsvp',     r.status
      )
      FROM club_sessions cs
      JOIN venue_memberships vm ON vm.club_id = cs.club_id
        AND vm.member_profile_id = child.id
        AND vm.status IN ('active', 'ending')
      JOIN clubs c ON c.id = cs.club_id
      LEFT JOIN club_session_rsvps r
             ON r.session_id = cs.id AND r.member_profile_id = child.id
      WHERE cs.status = 'scheduled'
        AND cs.scheduled_at > now()
      ORDER BY cs.scheduled_at
      LIMIT 1
    )
  ) ORDER BY child.first_name), '[]'::jsonb)
  INTO v_children
  FROM member_guardians mg
  JOIN member_profiles child ON child.id = mg.child_profile_id
  WHERE mg.guardian_profile_id = v_profile_id;

  RETURN jsonb_build_object('children', v_children);
END;
$$;

REVOKE ALL ON FUNCTION public.get_guardian_home_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guardian_home_feed() TO authenticated;


-- ─── 4. get_child_live_match(p_player_profile_id uuid) ────────────────────────
-- Guardian Follow Live. Returns the currently in_progress fixture for a child.
-- Guards: caller must be guardian of the child (member_guardians edge).
-- Returns {ok:false} when no live match — not an error.

CREATE OR REPLACE FUNCTION public.get_child_live_match(
  p_player_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_profile_id   uuid;
  v_child_uid    uuid;
  v_fixture      record;
  v_events       jsonb;
  v_venue_id     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id
  FROM member_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001';
  END IF;

  -- Confirm guardian relationship
  IF NOT EXISTS (
    SELECT 1 FROM member_guardians
    WHERE guardian_profile_id = v_profile_id
      AND child_profile_id = p_player_profile_id
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001';
  END IF;

  -- Get the child's auth_user_id to find their players row
  SELECT auth_user_id INTO v_child_uid
  FROM member_profiles
  WHERE id = p_player_profile_id;

  -- If the child has no auth account (most Phase 0 children), no live match
  IF v_child_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_live_match');
  END IF;

  -- Find an in_progress fixture for any team the child is registered to
  SELECT
    f.id,
    f.competition_id,
    f.home_team_id,
    f.away_team_id,
    f.home_score,
    f.away_score,
    f.status,
    ht.name AS home_name,
    ht.primary_colour AS home_colour,
    at.name AS away_name,
    at.primary_colour AS away_colour,
    comp.name AS competition_name,
    pr.team_id AS my_team_id
  INTO v_fixture
  FROM player_registrations pr
  JOIN players p ON p.id = pr.player_id
  JOIN fixtures f ON f.home_team_id = pr.team_id OR f.away_team_id = pr.team_id
  JOIN competitions comp ON comp.id = f.competition_id
  LEFT JOIN teams ht ON ht.id = f.home_team_id
  LEFT JOIN teams at ON at.id = f.away_team_id
  WHERE p.user_id = v_child_uid
    AND pr.status = 'active'
    AND f.status = 'in_progress'
  ORDER BY f.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_live_match');
  END IF;

  -- Recent match events (last 20)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event_type', me.event_type,
    'minute',     me.minute,
    'period',     me.period,
    'team_id',    me.team_id,
    'player_id',  me.player_id
  ) ORDER BY me.minute ASC NULLS LAST, me.local_timestamp ASC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT * FROM match_events
    WHERE fixture_id = v_fixture.id
    ORDER BY minute ASC NULLS LAST, local_timestamp ASC
    LIMIT 20
  ) me;

  -- Venue for realtime subscription: fixture → competition → season → league → venue
  SELECT l.venue_id INTO v_venue_id
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE c.id = v_fixture.competition_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok',      true,
    'fixture', jsonb_build_object(
      'id',              v_fixture.id,
      'competition',     v_fixture.competition_name,
      'my_team_id',      v_fixture.my_team_id,
      'home_team_id',    v_fixture.home_team_id,
      'home_team_name',  v_fixture.home_name,
      'home_team_colour', v_fixture.home_colour,
      'away_team_id',    v_fixture.away_team_id,
      'away_team_name',  v_fixture.away_name,
      'away_team_colour', v_fixture.away_colour,
      'home_score',      v_fixture.home_score,
      'away_score',      v_fixture.away_score
    ),
    'venue_id', v_venue_id,
    'events',   v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_child_live_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_child_live_match(uuid) TO authenticated;
