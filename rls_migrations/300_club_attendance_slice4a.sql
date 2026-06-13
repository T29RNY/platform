-- Migration 300 — Phase 10 Club Attendance: Slice 4A
-- Schema extension for team structure, fixtures, and guest appearances.
-- Drops the mig-055 dead club_teams table (0 rows, no references, league domain stub)
-- and recreates club_teams as membership-domain playing groups within cohorts.

-- ─── 0. Drop legacy dead table ───────────────────────────────────────────────

DROP TABLE IF EXISTS public.club_teams CASCADE;

-- ─── 1. club_teams — playing groups within a cohort ──────────────────────────

CREATE TABLE public.club_teams (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  cohort_id  uuid        NOT NULL REFERENCES public.club_cohorts(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX club_teams_club_id_idx    ON public.club_teams (club_id);
CREATE INDEX club_teams_cohort_id_idx  ON public.club_teams (cohort_id);
ALTER TABLE public.club_teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_teams FROM anon, authenticated;

-- ─── 2. club_team_members — seasonal team assignment ─────────────────────────

CREATE TABLE public.club_team_members (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid        NOT NULL REFERENCES public.club_teams(id) ON DELETE CASCADE,
  member_profile_id uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  is_active         boolean     NOT NULL DEFAULT true,
  assigned_at       timestamptz NOT NULL DEFAULT now()
);

-- A player can't be actively assigned to the same team twice
CREATE UNIQUE INDEX club_team_members_active_uq
  ON public.club_team_members (team_id, member_profile_id)
  WHERE is_active = true;

CREATE INDEX club_team_members_member_idx ON public.club_team_members (member_profile_id);
ALTER TABLE public.club_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_team_members FROM anon, authenticated;

-- ─── 3. club_team_managers — manager role per team ───────────────────────────

CREATE TABLE public.club_team_managers (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid        NOT NULL REFERENCES public.club_teams(id) ON DELETE CASCADE,
  member_profile_id uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  role              text        NOT NULL CHECK (role IN ('manager', 'assistant_manager', 'coach')),
  is_active         boolean     NOT NULL DEFAULT true,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, member_profile_id)
);

CREATE INDEX club_team_managers_member_idx ON public.club_team_managers (member_profile_id);
ALTER TABLE public.club_team_managers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_team_managers FROM anon, authenticated;

-- ─── 4. club_session_guests — one-game appearances ───────────────────────────

CREATE TABLE public.club_session_guests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                  uuid        NOT NULL REFERENCES public.club_sessions(id) ON DELETE CASCADE,
  member_profile_id           uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  added_by_manager_profile_id uuid        REFERENCES public.member_profiles(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, member_profile_id)
);

CREATE INDEX club_session_guests_session_idx ON public.club_session_guests (session_id);
ALTER TABLE public.club_session_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_session_guests FROM anon, authenticated;

-- ─── 5. Extend club_sessions ──────────────────────────────────────────────────

ALTER TABLE public.club_sessions
  ADD COLUMN session_type        text NOT NULL DEFAULT 'training'
    CHECK (session_type IN ('training', 'match', 'friendly', 'other')),
  ADD COLUMN team_id             uuid REFERENCES public.club_teams(id),
  ADD COLUMN opponent_name       text,
  ADD COLUMN home_away           text CHECK (home_away IN ('home', 'away', 'neutral')),
  ADD COLUMN opponent_venue_name text,
  ADD COLUMN opponent_address    text,
  ADD COLUMN meet_time           timestamptz;

-- ─── 6. member_list_upcoming_sessions — 3-way visibility ─────────────────────
-- A member sees a session if ANY of:
--   (a) session.team_id IS NULL AND caller has active membership for session.cohort_id
--   (b) session.team_id matches any active club_team_members row for caller
--   (c) caller has a club_session_guests row for the session

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
        'team_id',         cs.team_id,
        'title',           cs.title,
        'session_type',    cs.session_type,
        'scheduled_at',    cs.scheduled_at,
        'meet_time',       cs.meet_time,
        'location',        cs.location,
        'opponent_name',   cs.opponent_name,
        'home_away',       cs.home_away,
        'opponent_venue_name', cs.opponent_venue_name,
        'opponent_address',    cs.opponent_address,
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
      AND (
        -- (a) whole-cohort session: no team scoping AND caller has active membership for this cohort
        (cs.team_id IS NULL AND EXISTS (
          SELECT 1 FROM public.venue_memberships vm
          WHERE vm.club_id = p_club_id
            AND vm.member_profile_id = v_profile_id
            AND vm.status IN ('active', 'ending')
            AND (cs.cohort_id IS NULL OR vm.cohort_id = cs.cohort_id)
        ))
        OR
        -- (b) team-specific session: caller is an active member of that team
        (cs.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.club_team_members ctm
          WHERE ctm.team_id = cs.team_id
            AND ctm.member_profile_id = v_profile_id
            AND ctm.is_active = true
        ))
        OR
        -- (c) guest appearance: caller has a guest row for this session
        EXISTS (
          SELECT 1 FROM public.club_session_guests csg
          WHERE csg.session_id = cs.id
            AND csg.member_profile_id = v_profile_id
        )
      )
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.member_list_upcoming_sessions(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.member_list_upcoming_sessions(text, uuid) TO authenticated;
