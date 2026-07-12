-- 562_coach_reader_pitch_status_down.sql
-- Revert: restore guardian_list_children_sessions (mig 350), member_list_upcoming_sessions
-- and club_list_sessions (mig 412) to their pre-562 bodies — drop the additive
-- pitch_status key. Bodies are byte-identical to migs 350 / 412. Safe to run because
-- the added key was additive: no consumer NEEDS pitch_status server-side (the render
-- sites reading it live in the same PR and treat an absent key as "confirmed").

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
              'own_rsvp_status',     r.status
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
              (cs.team_id IS NULL AND EXISTS (
                SELECT 1 FROM venue_memberships vm
                WHERE vm.club_id = cs.club_id
                  AND vm.member_profile_id = child.id
                  AND vm.status IN ('active', 'ending')
                  AND (cs.cohort_id IS NULL OR vm.cohort_id = cs.cohort_id)
              ))
              OR
              (cs.team_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM club_team_members ctm
                WHERE ctm.team_id = cs.team_id
                  AND ctm.member_profile_id = child.id
                  AND ctm.is_active = true
              ))
              OR
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
        'own_rsvp_status',     r.status
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

SELECT pg_notify('pgrst', 'reload schema');
