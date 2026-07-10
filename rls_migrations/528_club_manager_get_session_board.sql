-- 528: Coach roster-aware session availability board — matches-parity 'No reply'.
--
-- The existing member_get_session_rsvp_board (mig 299) groups club_session_rsvps rows, so a
-- roster member who hasn't responded (no row) is invisible — you can't see "who hasn't
-- replied", which matches DO show (club_manager_list_team_fixtures computes pending as an
-- active roster member with no availability row, mig 451). This NEW coach-auth reader does
-- the same for a session: take the session's TEAM roster (club_team_members) LEFT JOIN the
-- RSVPs, so a member with no RSVP falls into 'pending' (No reply).
--
-- READ-ONLY (STABLE, no writes → no EV). Coach-gated: auth.uid → member_profiles → the
-- session's team must be one the caller ACTIVELY manages (club_team_managers). Same return
-- shape as member_get_session_rsvp_board (in/out/maybe as [{first_name}]) PLUS an accurate
-- 'pending' bucket, so the mobile SessionRsvpSheet swaps onto it with a one-line change.
-- SECURITY DEFINER, search_path pinned, single overload, REVOKE anon / GRANT authenticated.
--
-- Consumers (Hard Rule #14): apps/inorout SessionRsvpSheet.jsx (coach Training + Tonight).

CREATE OR REPLACE FUNCTION public.club_manager_get_session_board(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_sess    record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT cs.id, cs.team_id, cs.title, cs.scheduled_at, cs.location, cs.session_type, cs.status
    INTO v_sess
  FROM public.club_sessions cs WHERE cs.id = p_session_id;
  -- team-scoped sessions only (the coach manages a team; cohort-wide sessions have no
  -- single roster to compute no-reply against).
  IF v_sess.id IS NULL OR v_sess.team_id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = v_sess.team_id AND member_profile_id = v_profile AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'ok',           true,
      'session_id',   v_sess.id,
      'title',        v_sess.title,
      'scheduled_at', v_sess.scheduled_at,
      'session_type', v_sess.session_type,
      'location',     v_sess.location,
      'in',      COALESCE(jsonb_agg(jsonb_build_object('first_name', fn) ORDER BY fn) FILTER (WHERE st = 'in'),      '[]'::jsonb),
      'out',     COALESCE(jsonb_agg(jsonb_build_object('first_name', fn) ORDER BY fn) FILTER (WHERE st = 'out'),     '[]'::jsonb),
      'maybe',   COALESCE(jsonb_agg(jsonb_build_object('first_name', fn) ORDER BY fn) FILTER (WHERE st = 'maybe'),   '[]'::jsonb),
      'pending', COALESCE(jsonb_agg(jsonb_build_object('first_name', fn) ORDER BY fn) FILTER (WHERE st = 'pending'), '[]'::jsonb)
    )
    FROM (
      SELECT mp.first_name AS fn, COALESCE(r.status, 'pending') AS st
      FROM public.club_team_members m
      JOIN public.member_profiles mp ON mp.id = m.member_profile_id
      LEFT JOIN public.club_session_rsvps r
        ON r.session_id = p_session_id AND r.member_profile_id = m.member_profile_id
      WHERE m.team_id = v_sess.team_id AND m.is_active = true
    ) roster
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_get_session_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_get_session_board(uuid) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
