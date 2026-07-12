-- 562_coach_reader_pitch_status.sql
-- Coach self-service pitch booking — Phase 4a: surface club_sessions.pitch_status
-- across the SCHEDULE READERS so a pitch-pending / bumped session no longer renders
-- at its (now-lost) slot as if confirmed.
--
-- WHY (reader coupling, surfaced by the PR #3b review): mig 561 (bump-visibility
-- rewrite) makes a bumped club_session keep status='scheduled' (so it stays visible
-- + keeps its RSVPs) and signal the bump on its decoupled pitch_status='requested'
-- instead. mig 560 (coach book-a-pitch) likewise creates a clash-request session
-- status='scheduled', pitch_status='requested'. NEITHER holds occupancy, but BOTH
-- keep their original scheduled_at / venue / playing_area — so every schedule reader
-- (which filters status='scheduled') lists them at that stale slot as CONFIRMED.
-- No reader surfaces pitch_status yet, so the client cannot tell "confirmed" from
-- "pitch being confirmed" / "pitch TBC". This migration closes that gap. It is the
-- coupled reader change mig 561 was HELD for — apply 561 + 562 together.
--
-- WHAT: additive `'pitch_status', cs.pitch_status` key on the session object of the
-- three list readers. Signatures, SECURITY DEFINER, search_path and GRANTs are
-- byte-identical to the live bodies (pulled from migs 350 / 412) — the ONLY change
-- is the one added key per reader. No occupancy-trigger touch, no new RPC, no write.
--   * guardian_list_children_sessions  (mig 350)  — guardian /hub, per child
--   * member_list_upcoming_sessions    (mig 412)  — player upcoming + coach SessionsScreen
--   * club_list_sessions               (mig 412)  — venue console club-session list
-- The venue occupancy grid already carries pitch_status via _pitch_occupancy_detail
-- (mig 558) — no change needed there (and a non-'allocated' session holds no active
-- occupancy, so it can never render as a grid block anyway).
--
-- Consumers (Hard Rule #14): apps/inorout (ParentHomeScreen, SessionsScreen,
-- GuardianMatches, GuardianSchedule, TeamManagerTonight/Training via the shared
-- @platform/core pitchStatusMeta helper) + apps/venue (SessionsView). Additive key
-- only, so pre-existing consumers that don't read it are unaffected (Hard Rule #12:
-- the render sites that DO read it land in this same PR).
--
-- Backward-compat: every existing row defaults pitch_status='allocated' (mig 558),
-- which the client treats as "confirmed" — so unchanged sessions render exactly as
-- before. A NULL/absent value is also treated as confirmed client-side (belt & braces).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. guardian_list_children_sessions — + pitch_status on each child's session
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.guardian_list_children_sessions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_guardian uuid;
  v_children jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_guardian
  FROM member_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF v_guardian IS NULL THEN
    RETURN jsonb_build_object('children', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(child_obj ORDER BY fname, lname), '[]'::jsonb)
  INTO v_children
  FROM (
    SELECT
      child.first_name AS fname,
      child.last_name  AS lname,
      jsonb_build_object(
        'profile_id', child.id,
        'first_name', child.first_name,
        'last_name',  child.last_name,
        'sessions', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'session_id',          cs.id,
              'club_id',             cs.club_id,
              'club_name',           cl.name,
              'cohort_id',           cs.cohort_id,
              'cohort_name',         cc.name,
              'team_id',             cs.team_id,
              'title',               cs.title,
              'session_type',        cs.session_type,
              'scheduled_at',        cs.scheduled_at,
              'meet_time',           cs.meet_time,
              'location',            cs.location,
              'opponent_name',       cs.opponent_name,
              'home_away',           cs.home_away,
              'opponent_venue_name', cs.opponent_venue_name,
              'opponent_address',    cs.opponent_address,
              'notes',               cs.notes,
              'capacity',            cs.capacity,
              'own_rsvp_status',     r.status,
              -- NEW (mig 562): decoupled pitch state so the client can render
              -- "pitch being confirmed" / "pitch TBC" instead of a stale slot.
              'pitch_status',        cs.pitch_status
            ) ORDER BY cs.scheduled_at
          )
          FROM club_sessions cs
          JOIN clubs cl ON cl.id = cs.club_id
          LEFT JOIN club_cohorts cc ON cc.id = cs.cohort_id
          LEFT JOIN club_session_rsvps r
                 ON r.session_id = cs.id AND r.member_profile_id = child.id
          WHERE cs.status = 'scheduled'
            AND cs.scheduled_at > now()
            AND EXISTS (
              SELECT 1 FROM venue_memberships vm
              WHERE vm.club_id = cs.club_id
                AND vm.member_profile_id = child.id
                AND vm.status IN ('active', 'ending')
            )
            AND (
              -- (a) whole-cohort session: child has active membership for this cohort
              (cs.team_id IS NULL AND EXISTS (
                SELECT 1 FROM venue_memberships vm
                WHERE vm.club_id = cs.club_id
                  AND vm.member_profile_id = child.id
                  AND vm.status IN ('active', 'ending')
                  AND (cs.cohort_id IS NULL OR vm.cohort_id = cs.cohort_id)
              ))
              OR
              -- (b) team-specific session: child is an active player on that team
              (cs.team_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM club_team_members ctm
                WHERE ctm.team_id = cs.team_id
                  AND ctm.member_profile_id = child.id
                  AND ctm.is_active = true
              ))
              OR
              -- (c) child is a named session guest
              EXISTS (
                SELECT 1 FROM club_session_guests csg
                WHERE csg.session_id = cs.id
                  AND csg.member_profile_id = child.id
              )
            )
        ), '[]'::jsonb)
      ) AS child_obj
    FROM member_guardians mg
    JOIN member_profiles child ON child.id = mg.child_profile_id
    WHERE mg.guardian_profile_id = v_guardian
      AND mg.invite_state = 'accepted'
  ) children_q;

  RETURN jsonb_build_object('children', v_children);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_list_children_sessions() FROM public;
GRANT EXECUTE ON FUNCTION public.guardian_list_children_sessions() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. member_list_upcoming_sessions — + pitch_status (player upcoming + coach board)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.member_list_upcoming_sessions(p_club_id text, p_cohort_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE club_id = p_club_id
      AND member_profile_id = v_profile_id
      AND status IN ('active', 'ending')
  ) THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE = 'P0001';
  END IF;

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
        -- NEW (mig 562): decoupled pitch state — client renders confirmed vs
        -- "pitch being confirmed" (requested) / "pitch TBC" (none/declined/expired).
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
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. club_list_sessions (venue console) — + pitch_status on each session row
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_list_sessions(
  p_venue_token text, p_club_id text, p_cohort_id uuid DEFAULT NULL::uuid,
  p_from timestamptz DEFAULT NULL::timestamptz, p_to timestamptz DEFAULT NULL::timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'session_id',        cs.id,
        'club_id',           cs.club_id,
        'cohort_id',         cs.cohort_id,
        'cohort_name',       cc.name,
        'title',             cs.title,
        'scheduled_at',      cs.scheduled_at,
        'location',          cs.location,
        'venue_id',          cs.venue_id,
        'venue_name',        v.name,
        'venue_address',     NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
        'playing_area_id',   cs.playing_area_id,
        'playing_area_name', pa.name,
        'notes',             cs.notes,
        'capacity',          cs.capacity,
        'status',            cs.status,
        -- NEW (mig 562): decoupled pitch state so the console can chip a
        -- requested/declined session "Pitch TBC" instead of its stale slot.
        'pitch_status',      cs.pitch_status,
        'cancelled_reason',  cs.cancelled_reason,
        'series_id',         cs.series_id,
        'series_title',      css.title,
        'rsvp_in',           (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'in'),
        'rsvp_out',          (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'out'),
        'rsvp_maybe',        (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'maybe'),
        'attendance_marked', EXISTS (SELECT 1 FROM public.club_session_attendance a WHERE a.session_id = cs.id)
      ) ORDER BY cs.scheduled_at
    ), '[]'::jsonb)
    FROM public.club_sessions cs
    LEFT JOIN public.club_cohorts cc ON cc.id = cs.cohort_id
    LEFT JOIN public.club_session_series css ON css.id = cs.series_id
    LEFT JOIN public.venues v ON v.id = cs.venue_id
    LEFT JOIN public.playing_areas pa ON pa.id = cs.playing_area_id
    WHERE cs.club_id = p_club_id
      AND (p_cohort_id IS NULL OR cs.cohort_id = p_cohort_id)
      AND (p_from IS NULL OR cs.scheduled_at >= p_from)
      AND (p_to   IS NULL OR cs.scheduled_at <= p_to)
  );
END;
$fn$;

-- PostgREST schema cache refresh (return-shape change on 3 functions)
SELECT pg_notify('pgrst', 'reload schema');
