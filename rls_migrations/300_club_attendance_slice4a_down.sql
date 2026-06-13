-- Down migration 300 — reverses Slice 4A schema extension
-- Note: does NOT restore the mig-055 club_teams stub (it was dead schema).

-- Restore member_list_upcoming_sessions to mig-299 body
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

-- Remove new club_sessions columns
ALTER TABLE public.club_sessions
  DROP COLUMN IF EXISTS session_type,
  DROP COLUMN IF EXISTS team_id,
  DROP COLUMN IF EXISTS opponent_name,
  DROP COLUMN IF EXISTS home_away,
  DROP COLUMN IF EXISTS opponent_venue_name,
  DROP COLUMN IF EXISTS opponent_address,
  DROP COLUMN IF EXISTS meet_time;

-- Drop new tables (cascade handles indexes + policies)
DROP TABLE IF EXISTS public.club_session_guests   CASCADE;
DROP TABLE IF EXISTS public.club_team_managers    CASCADE;
DROP TABLE IF EXISTS public.club_team_members     CASCADE;
DROP TABLE IF EXISTS public.club_teams            CASCADE;
