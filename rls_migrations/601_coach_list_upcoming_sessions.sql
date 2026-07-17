-- 601_coach_list_upcoming_sessions.sql
--
-- Coach-authorised twin of member_list_upcoming_sessions (mig 412/562).
--
-- BUG (BUGS.md 2026-07-17, PA Sports coach walk): the coach /hub Training screen
-- (TeamManagerTraining) lists sessions via member_list_upcoming_sessions, whose FIRST
-- act is a venue_memberships gate that RAISEs 'membership_required'. A volunteer coach
-- has a club_team_managers row but NO venue_memberships row, so the reader hard-fails
-- ("Couldn't load sessions") even though its own session SELECT already contains a
-- club_team_managers visibility branch. Nihal (PA U7 Dortmund) — 1 coaching team,
-- 0 memberships — reproduced this against 6 real sessions.
--
-- FIX (durable): a NEW read RPC that authorises by COACH status (active club_team_managers
-- row for a team in the club) instead of paying membership, then runs the IDENTICAL
-- session SELECT so the returned shape is byte-identical to member_list_upcoming_sessions
-- (client mapper unchanged). No data is exposed that the member reader wouldn't already
-- return for the same caller — a coach only ever sees sessions for teams they coach /
-- are a member of. Auth pattern mirrors club_manager_list_team_fixtures (mig 451/554).
--
-- Consumers (Hard Rule 14): apps/inorout TeamManagerTraining (the reported bug),
-- TeamManagerTonight (same silent bug — section vanished for a non-member coach),
-- ManagerBookings (coach Pitch-calendar pending-request cross-check; dark behind
-- VITE_SELF_BOOKING_ENABLED). Member/guardian surfaces (SessionsScreen, GuardianSchedule)
-- keep the membership-gated member_list_upcoming_sessions.

CREATE OR REPLACE FUNCTION public.club_manager_list_upcoming_sessions(p_club_id text, p_cohort_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;

  -- Coach gate (replaces the membership gate): the caller must actively coach at least
  -- one team in this club. A NULL v_profile_id (no member profile) falls through to
  -- not_authorised. Mirrors club_manager_list_team_fixtures.
  IF NOT EXISTS (
    SELECT 1
    FROM public.club_team_managers ctm
    JOIN public.club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ctm.is_active = true
      AND ct.club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Session SELECT: IDENTICAL to member_list_upcoming_sessions (mig 562) so the shape
  -- (incl. pitch_status) is byte-identical. The visibility branches already scope a
  -- coach to sessions for teams they manage (+ any they're a member/guest of).
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'session_id',          cs.id,
        'club_id',             cs.club_id,
        'cohort_id',           cs.cohort_id,
        'cohort_name',         cc.name,
        'team_id',             cs.team_id,
        'title',               cs.title,
        'session_type',        cs.session_type,
        'scheduled_at',        cs.scheduled_at,
        'meet_time',           cs.meet_time,
        'location',            cs.location,
        'venue_id',            cs.venue_id,
        'venue_name',          v.name,
        'venue_address',       NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
        'opponent_name',       cs.opponent_name,
        'home_away',           cs.home_away,
        'opponent_venue_name', cs.opponent_venue_name,
        'opponent_address',    cs.opponent_address,
        'notes',               cs.notes,
        'capacity',            cs.capacity,
        'own_rsvp_status',     r.status,
        'pitch_status',        cs.pitch_status
      ) ORDER BY cs.scheduled_at
    )
    FROM public.club_sessions cs
    LEFT JOIN public.club_cohorts cc ON cc.id = cs.cohort_id
    LEFT JOIN public.venues v ON v.id = cs.venue_id
    LEFT JOIN public.club_session_rsvps r
           ON r.session_id = cs.id AND r.member_profile_id = v_profile_id
    WHERE cs.club_id = p_club_id
      AND cs.status = 'scheduled'
      AND cs.scheduled_at > now()
      AND (p_cohort_id IS NULL OR cs.cohort_id = p_cohort_id)
      AND (
        (cs.team_id IS NULL AND EXISTS (
          SELECT 1 FROM public.venue_memberships vm
          WHERE vm.club_id = p_club_id
            AND vm.member_profile_id = v_profile_id
            AND vm.status IN ('active', 'ending')
            AND (cs.cohort_id IS NULL OR vm.cohort_id = cs.cohort_id)
        ))
        OR
        (cs.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.club_team_members ctm
          WHERE ctm.team_id = cs.team_id
            AND ctm.member_profile_id = v_profile_id
            AND ctm.is_active = true
        ))
        OR
        EXISTS (
          SELECT 1 FROM public.club_session_guests csg
          WHERE csg.session_id = cs.id
            AND csg.member_profile_id = v_profile_id
        )
        OR
        (cs.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.club_team_managers ctm
          WHERE ctm.team_id = cs.team_id
            AND ctm.member_profile_id = v_profile_id
            AND ctm.is_active = true
        ))
      )
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL    ON FUNCTION public.club_manager_list_upcoming_sessions(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_list_upcoming_sessions(text, uuid) TO authenticated;
