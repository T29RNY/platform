-- 522_get_my_world_admin_clubs.sql
--
-- Generic tenant lens — PR follow-up to the club-admin /hub track.
--
-- THE GAP: mig 520 routes a venue_admin into the club_admin /hub track ONLY when
-- their venue is a dedicated single-club SELF-SERVE SHELL (a venueless club). But a
-- REAL operator who runs a club at one or more physical venues (e.g. PA Sports, at
-- two grounds) has non-self_serve venues, so mig 520 emits club_id = NULL and they
-- never reach the club screens on mobile — they only get the venue-operator track.
--
-- THE FIX (generic, vertical-agnostic): add an ADDITIVE `admin_clubs` arm — the
-- DISTINCT clubs the caller administers, derived from their active venue_admins ->
-- club_venues, DEDUPED across every location, with one venue picked as the
-- venue-token credential (min venue_id among the caller's own admin venues for that
-- club — deterministic; any linked venue works, resolve_venue_caller + the
-- club_venues gate accept it). nav.js emits ONE club_admin hat per entry, ALONGSIDE
-- the operator hats. A pure shell still suppresses its empty operator hat (nav.js
-- keys that off the mig-520 origin+club_id it already carries).
--
-- Future-proof: this is the identity spine for the "generic tenant lens". It keys
-- on club_venues, so a gym org across N sites, or a league, lights up the same way
-- with zero new plumbing — one org -> one club_admin hat regardless of location count.
--
-- SAFETY — lowest-risk change to the highest-traffic RPC:
--   * PURELY ADDITIVE. One new local var (v_admin_clubs), one new SELECT INTO, one
--     new top-level RETURN key ('admin_clubs'). EVERY pre-existing arm and key —
--     including the mig-520 venue arm (origin/club_id) — is byte-identical to the
--     live definition (verified == mig 520 at build time). getMyWorld() has no mapper
--     (returns raw), so admin_clubs reaches nav.js untouched.
--   * STABLE SECURITY DEFINER, search_path pinned, no signature/grant change.
--   * The new arm reads only the caller's own rows (va.person_id = v_person, active,
--     not revoked, not a personal host) -> no cross-tenant exposure; clubs surfaced
--     are exactly the ones whose venue the caller already admins.
--
-- Whole function reproduced verbatim from the live definition (== mig 520); the ONLY
-- additions are marked ← mig 522.

CREATE OR REPLACE FUNCTION public.get_my_world()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_admin_clubs jsonb;   -- ← mig 522
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

  v_ref := COALESCE(public.get_my_assignments(NULL) -> 'games', '[]'::jsonb)
        || COALESCE(public.get_my_tournament_assignments() -> 'games', '[]'::jsonb);

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
    -- mig 520: two ADDITIVE keys (origin, club_id) so nav.js can route a dedicated
    --   club-shell venue into the club_admin /hub track. All prior keys unchanged.
    SELECT jsonb_build_object(
      'type', 'venue_admin',
      'entity_id', va.venue_id,
      'name', v.name,
      'role', va.role,
      'origin', v.origin,
      'club_id', CASE WHEN v.origin = 'self_serve' THEN (
          -- Dedicated club shell = a self_serve venue linked to EXACTLY ONE club
          -- (the mig-518 signature). Facility/self-serve venue with 0 or >1 clubs -> NULL.
          SELECT CASE WHEN count(*) = 1 THEN min(cv.club_id) ELSE NULL END
          FROM public.club_venues cv
          WHERE cv.venue_id = va.venue_id
        ) ELSE NULL END
    )
    FROM public.venue_admins va
    JOIN public.venues v ON v.id = va.venue_id
    WHERE va.person_id = v_person AND va.status = 'active' AND va.revoked_at IS NULL
      AND COALESCE(v.is_personal_host, false) = false   -- mig 494: hide the hidden self-serve host from the operator hat
  ) q;

  -- ← mig 522: the DISTINCT clubs this caller administers (via their active
  --   venue_admins -> club_venues), DEDUPED across every location, each with one
  --   venue picked as the venue-token credential. Generic across verticals (club /
  --   gym org / league). nav.js emits one club_admin /hub hat per entry.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',  ac.club_id,
    'name',     c.name,
    'venue_id', ac.venue_id,
    'role',     ac.role
  ) ORDER BY c.name), '[]'::jsonb)
  INTO v_admin_clubs
  FROM (
    SELECT cv.club_id,
           min(va.venue_id) AS venue_id,
           -- the caller's HIGHEST-privilege role among this club's venues (owner >
           -- manager > staff). nav.js ranks the club_admin hat by it, so a non-owner
           -- venue operator is never DEFAULTED into the club console above their real
           -- operator hat — the server still re-derives + enforces caps regardless.
           (array_agg(va.role ORDER BY CASE va.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END))[1] AS role
    FROM public.venue_admins va
    JOIN public.venues v ON v.id = va.venue_id
    JOIN public.club_venues cv ON cv.venue_id = va.venue_id
    WHERE va.person_id = v_person AND va.status = 'active' AND va.revoked_at IS NULL
      AND COALESCE(v.is_personal_host, false) = false
    GROUP BY cv.club_id
  ) ac
  JOIN public.clubs c ON c.id = ac.club_id;

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
    'admin_clubs',      v_admin_clubs,   -- ← mig 522
    'coaching',         v_coach,
    'conflicts',        v_conflicts
  );
END;
$function$;
