-- Migration 299 — Phase 10 Club Attendance: Slice 2
-- Member RPCs: member_list_upcoming_sessions, member_rsvp_session, member_get_session_rsvp_board
-- Auth pattern: auth.uid() → member_profiles.auth_user_id
-- Membership check: venue_memberships WHERE club_id + member_profile_id + status IN ('active','ending')
-- Audit pattern: team_id='_system', actor_user_id=auth.uid(), actor_type='player'

-- ─── 1. member_list_upcoming_sessions ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_list_upcoming_sessions(
  p_club_id    text,
  p_cohort_id  uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
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
        'session_id',      cs.id,
        'club_id',         cs.club_id,
        'cohort_id',       cs.cohort_id,
        'cohort_name',     cc.name,
        'title',           cs.title,
        'scheduled_at',    cs.scheduled_at,
        'location',        cs.location,
        'notes',           cs.notes,
        'capacity',        cs.capacity,
        'own_rsvp_status', r.status
      ) ORDER BY cs.scheduled_at
    )
    FROM public.club_sessions cs
    LEFT JOIN public.club_cohorts cc ON cc.id = cs.cohort_id
    LEFT JOIN public.club_session_rsvps r
           ON r.session_id = cs.id AND r.member_profile_id = v_profile_id
    WHERE cs.club_id = p_club_id
      AND cs.status = 'scheduled'
      AND cs.scheduled_at > now()
      AND (p_cohort_id IS NULL OR cs.cohort_id = p_cohort_id)
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.member_list_upcoming_sessions(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.member_list_upcoming_sessions(text, uuid) TO authenticated;

-- ─── 2. member_rsvp_session ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.member_rsvp_session(
  p_session_id     uuid,
  p_status         text,
  p_for_profile_id uuid DEFAULT NULL,
  p_note           text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid            uuid := auth.uid();
  v_caller_profile uuid;
  v_target_profile uuid;
  v_club_id        text;
  v_rsvp_id        uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('in', 'out', 'maybe') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve session (only 'scheduled' sessions accept RSVPs)
  SELECT cs.club_id INTO v_club_id
  FROM public.club_sessions cs
  WHERE cs.id = p_session_id AND cs.status = 'scheduled';

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve caller's own profile
  SELECT id INTO v_caller_profile FROM public.member_profiles WHERE auth_user_id = v_uid;

  -- Guardian check if RSVPing on behalf of another profile
  IF p_for_profile_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE guardian_profile_id = v_caller_profile
        AND child_profile_id = p_for_profile_id
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001';
    END IF;
    v_target_profile := p_for_profile_id;
  ELSE
    v_target_profile := v_caller_profile;
  END IF;

  -- Active membership check on target profile
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE club_id = v_club_id
      AND member_profile_id = v_target_profile
      AND status IN ('active', 'ending')
  ) THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_session_rsvps
    (session_id, member_profile_id, rsvp_by_profile_id, status, note)
  VALUES (p_session_id, v_target_profile, v_caller_profile, p_status, p_note)
  ON CONFLICT (session_id, member_profile_id)
    DO UPDATE SET
      status             = EXCLUDED.status,
      note               = EXCLUDED.note,
      rsvp_by_profile_id = EXCLUDED.rsvp_by_profile_id,
      updated_at         = now()
  RETURNING id INTO v_rsvp_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player', 'club_session_rsvp_set',
    'club_session_rsvp', v_rsvp_id::text,
    jsonb_build_object(
      'session_id',     p_session_id,
      'club_id',        v_club_id,
      'target_profile', v_target_profile,
      'status',         p_status
    )
  );

  RETURN jsonb_build_object('ok', true, 'rsvp_id', v_rsvp_id, 'status', p_status);
END;
$fn$;

REVOKE ALL ON FUNCTION public.member_rsvp_session(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.member_rsvp_session(uuid, text, uuid, text) TO authenticated;

-- ─── 3. member_get_session_rsvp_board ────────────────────────────────────────
-- Returns first names only per operator decision (same pattern as club_get_session_rsvps).

CREATE OR REPLACE FUNCTION public.member_get_session_rsvp_board(
  p_session_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT cs.club_id INTO v_club_id
  FROM public.club_sessions cs
  WHERE cs.id = p_session_id;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE club_id = v_club_id
      AND member_profile_id = v_profile_id
      AND status IN ('active', 'ending')
  ) THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'in',      COALESCE((
      SELECT jsonb_agg(jsonb_build_object('first_name', mp.first_name) ORDER BY mp.first_name)
      FROM public.club_session_rsvps r
      JOIN public.member_profiles mp ON mp.id = r.member_profile_id
      WHERE r.session_id = p_session_id AND r.status = 'in'
    ), '[]'::jsonb),
    'out',     COALESCE((
      SELECT jsonb_agg(jsonb_build_object('first_name', mp.first_name) ORDER BY mp.first_name)
      FROM public.club_session_rsvps r
      JOIN public.member_profiles mp ON mp.id = r.member_profile_id
      WHERE r.session_id = p_session_id AND r.status = 'out'
    ), '[]'::jsonb),
    'maybe',   COALESCE((
      SELECT jsonb_agg(jsonb_build_object('first_name', mp.first_name) ORDER BY mp.first_name)
      FROM public.club_session_rsvps r
      JOIN public.member_profiles mp ON mp.id = r.member_profile_id
      WHERE r.session_id = p_session_id AND r.status = 'maybe'
    ), '[]'::jsonb),
    'pending', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('first_name', mp.first_name) ORDER BY mp.first_name)
      FROM public.club_session_rsvps r
      JOIN public.member_profiles mp ON mp.id = r.member_profile_id
      WHERE r.session_id = p_session_id AND r.status = 'pending'
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.member_get_session_rsvp_board(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.member_get_session_rsvp_board(uuid) TO authenticated;
