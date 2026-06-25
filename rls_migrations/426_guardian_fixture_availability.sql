-- Migration 426 — Guardian app Phase 1: parent-on-behalf-of-child availability
-- for FA grassroots LEAGUE fixtures (club_fixtures).
--
-- WHY: club_sessions already support guardian->child RSVP via member_rsvp_session
-- (mig 299) + club_session_rsvps. club_fixtures (the FA grassroots league table,
-- mig 394) have scores + standings but ZERO availability concept and no
-- guardian/child reader. The Guardian Matches screen (apps/inorout /hub) needs
-- both: a writer so a parent can mark a child in/out for a league game, and a
-- reader returning the child's upcoming + recent league fixtures with the answer.
--
-- WHAT:
--   1. club_fixture_availability — one row per (fixture, child), RPC-only.
--   2. guardian_set_fixture_availability — guardian-gated upsert + audit.
--   3. guardian_list_child_fixtures — child's upcoming + recent league fixtures
--      with own availability joined in.
--
-- SECURITY mirrors member_rsvp_session (mig 299): auth.uid()->member_profiles,
-- member_guardians(invite_state='accepted') guardian check, child must be an
-- active club_team_member on the fixture's club_team_id. Write fires an
-- audit_events row (Hard Rule #9). Consumers (Hard Rule #14): apps/inorout
-- guardian Matches screen (GuardianMatches.jsx).

-- ─── 1. club_fixture_availability ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_fixture_availability (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id          uuid        NOT NULL REFERENCES public.club_fixtures(id) ON DELETE CASCADE,
  member_profile_id   uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  rsvp_by_profile_id  uuid        REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  status              text        NOT NULL DEFAULT 'pending',
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_fixture_availability_status_check CHECK (status IN ('in','out','maybe','pending')),
  CONSTRAINT uq_fixture_availability_member UNIQUE (fixture_id, member_profile_id)
);

ALTER TABLE public.club_fixture_availability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_fixture_availability FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_cfa_fixture ON public.club_fixture_availability (fixture_id);
CREATE INDEX IF NOT EXISTS idx_cfa_member  ON public.club_fixture_availability (member_profile_id);

-- ─── 2. guardian_set_fixture_availability ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_set_fixture_availability(
  p_fixture_id     uuid,
  p_status         text,
  p_for_profile_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid             uuid := auth.uid();
  v_caller_profile  uuid;
  v_target_profile  uuid;
  v_club_team_id    uuid;
  v_avail_id        uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('in','out','maybe') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  -- Only scheduled fixtures accept availability.
  SELECT cf.club_team_id INTO v_club_team_id
  FROM public.club_fixtures cf
  WHERE cf.id = p_fixture_id AND cf.status = 'scheduled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_club_team_id IS NULL THEN
    RAISE EXCEPTION 'fixture_has_no_team' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_caller_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001';
  END IF;

  -- Guardian check when acting for a child; else act for self.
  IF p_for_profile_id IS NOT NULL AND p_for_profile_id <> v_caller_profile THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE guardian_profile_id = v_caller_profile
        AND child_profile_id    = p_for_profile_id
        AND invite_state        = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001';
    END IF;
    v_target_profile := p_for_profile_id;
  ELSE
    v_target_profile := v_caller_profile;
  END IF;

  -- Target must be an active member of the fixture's team.
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_members ctm
    WHERE ctm.team_id           = v_club_team_id
      AND ctm.member_profile_id = v_target_profile
      AND ctm.is_active         = true
  ) THEN
    RAISE EXCEPTION 'not_on_team' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_fixture_availability
    (fixture_id, member_profile_id, rsvp_by_profile_id, status)
  VALUES (p_fixture_id, v_target_profile, v_caller_profile, p_status)
  ON CONFLICT (fixture_id, member_profile_id)
    DO UPDATE SET
      status             = EXCLUDED.status,
      rsvp_by_profile_id = EXCLUDED.rsvp_by_profile_id,
      updated_at         = now()
  RETURNING id INTO v_avail_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    '_system', v_uid, 'player', 'club_fixture_availability_set',
    'club_fixture_availability', v_avail_id::text,
    jsonb_build_object(
      'fixture_id',     p_fixture_id,
      'club_team_id',   v_club_team_id,
      'target_profile', v_target_profile,
      'status',         p_status
    )
  );

  RETURN jsonb_build_object('ok', true, 'availability_id', v_avail_id, 'status', p_status);
END;
$fn$;

REVOKE ALL ON FUNCTION public.guardian_set_fixture_availability(uuid, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardian_set_fixture_availability(uuid, text, uuid) TO authenticated;

-- ─── 3. guardian_list_child_fixtures ─────────────────────────────────────────
-- For ONE child of the caller: upcoming (scheduled, today onward) league
-- fixtures + recent results (completed, last 6), each with the child's own
-- availability. Guardian-gated; a member may also pass their own profile id.
CREATE OR REPLACE FUNCTION public.guardian_list_child_fixtures(
  p_child_profile_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid            uuid := auth.uid();
  v_caller_profile uuid;
  v_upcoming       jsonb;
  v_recent         jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_caller_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001';
  END IF;

  IF p_child_profile_id <> v_caller_profile AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller_profile
      AND child_profile_id    = p_child_profile_id
      AND invite_state        = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001';
  END IF;

  -- Upcoming: scheduled fixtures for any active team the child is on.
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'scheduled_date'), (row_obj->>'kickoff_time')), '[]'::jsonb)
  INTO v_upcoming
  FROM (
    SELECT jsonb_build_object(
      'fixture_id',      cf.id,
      'league_id',       cf.league_id,
      'league_name',     cl.name,
      'club_team_id',    cf.club_team_id,
      'club_team_name',  COALESCE(cf.club_team_name, ct.name),
      'opponent_name',   cf.opponent_name,
      'is_home',         cf.is_home,
      'scheduled_date',  cf.scheduled_date,
      'kickoff_time',    to_char(cf.kickoff_time, 'HH24:MI'),
      'pitch_name',      pa.name,
      'venue_name',      v.name,
      'ref_name',        COALESCE(mo.name, cf.ref_name),
      'status',          cf.status,
      'own_rsvp_status', a.status
    ) AS row_obj
    FROM public.club_fixtures cf
    JOIN public.club_team_members ctm
      ON ctm.team_id = cf.club_team_id
     AND ctm.member_profile_id = p_child_profile_id
     AND ctm.is_active = true
    LEFT JOIN public.club_leagues  cl ON cl.id = cf.league_id
    LEFT JOIN public.club_teams    ct ON ct.id = cf.club_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = cf.playing_area_id
    LEFT JOIN public.venues        v  ON v.id  = pa.venue_id
    LEFT JOIN public.match_officials mo ON mo.id = cf.official_id
    LEFT JOIN public.club_fixture_availability a
      ON a.fixture_id = cf.id AND a.member_profile_id = p_child_profile_id
    WHERE cf.status = 'scheduled'
      AND cf.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date
  ) up;

  -- Recent: completed fixtures (scores), most recent 6.
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'scheduled_date') DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'fixture_id',     cf.id,
      'league_id',      cf.league_id,
      'league_name',    cl.name,
      'club_team_id',   cf.club_team_id,
      'club_team_name', COALESCE(cf.club_team_name, ct.name),
      'opponent_name',  cf.opponent_name,
      'is_home',        cf.is_home,
      'scheduled_date', cf.scheduled_date,
      'kickoff_time',   to_char(cf.kickoff_time, 'HH24:MI'),
      'home_score',     cf.home_score,
      'away_score',     cf.away_score,
      'status',         cf.status
    ) AS row_obj
    FROM public.club_fixtures cf
    JOIN public.club_team_members ctm
      ON ctm.team_id = cf.club_team_id
     AND ctm.member_profile_id = p_child_profile_id
     AND ctm.is_active = true
    LEFT JOIN public.club_leagues cl ON cl.id = cf.league_id
    LEFT JOIN public.club_teams   ct ON ct.id = cf.club_team_id
    WHERE cf.status = 'completed'
    ORDER BY cf.scheduled_date DESC
    LIMIT 6
  ) rec;

  RETURN jsonb_build_object(
    'ok', true,
    'child_profile_id', p_child_profile_id,
    'upcoming', v_upcoming,
    'recent',   v_recent
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.guardian_list_child_fixtures(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.guardian_list_child_fixtures(uuid) TO anon, authenticated;
