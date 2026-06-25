-- Migration 428 — Guardian app Phase 1, screen 2 (League): a read model for a
-- child's grassroots league(s).
--
-- WHY: the Guardian League screen (apps/inorout /hub, tab "league") shows Table /
-- Fixtures / Results for the child's club league. Grassroots club_fixtures record
-- only ONE club's own games vs FREE-TEXT opponent names — there is no opponent
-- entity and no cross-team result graph, so a real computed league TABLE is
-- impossible (confirmed audit; mirrors the mig-394/397 spike NO-GO). The honest
-- model: Fixtures + Results come straight from the child's club_fixtures, and the
-- "Table" tab shows (a) the official FA Full-Time table OFF-APP via the stored
-- fa_embed_code / fa_source_url, and (b) the child's TEAM season form (P/W/D/L/GD/
-- Pts/last-5) computed here — labelled as the team's record, never a league rank.
--
-- WHAT: guardian_list_child_leagues(child) → { ok, child_profile_id, leagues:[...] },
-- one block per (team, league) the child plays in:
--   league_id, league_name, season_label, club_name, fa_embed_code, fa_source_url,
--   club_team_id, club_team_name,
--   form: { played, won, drawn, lost, gf, ga, gd, points, last5:[ 'W'|'D'|'L' ] },
--   fixtures: [ upcoming scheduled, date asc ],
--   results:  [ completed w/ scores, date desc ].
--
-- SECURITY mirrors guardian_list_child_fixtures (mig 426): auth.uid()->member_profiles,
-- member_guardians(invite_state='accepted') guardian check (or self). Read-only
-- (no audit row, no EV — Hard Rule #9/EV apply to writes only). Consumers
-- (Hard Rule #14): apps/inorout guardian League screen (GuardianLeague.jsx).

CREATE OR REPLACE FUNCTION public.guardian_list_child_leagues(
  p_child_profile_id uuid
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid            uuid := auth.uid();
  v_caller_profile uuid;
  v_today          date := (now() AT TIME ZONE 'Europe/London')::date;
  v_leagues        jsonb;
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

  WITH child_teams AS (
    -- distinct (team, league) pairs the child actively plays in
    SELECT DISTINCT ctm.team_id, cf.league_id
    FROM public.club_team_members ctm
    JOIN public.club_fixtures cf ON cf.club_team_id = ctm.team_id
    WHERE ctm.member_profile_id = p_child_profile_id
      AND ctm.is_active = true
  ),
  played AS (
    -- one row per completed, scored fixture, with the child's-team perspective
    SELECT ct.team_id, ct.league_id, cf.scheduled_date,
      (CASE WHEN cf.is_home THEN cf.home_score ELSE cf.away_score END) AS us,
      (CASE WHEN cf.is_home THEN cf.away_score ELSE cf.home_score END) AS them
    FROM child_teams ct
    JOIN public.club_fixtures cf
      ON cf.club_team_id = ct.team_id AND cf.league_id = ct.league_id
    WHERE cf.status = 'completed'
      AND cf.home_score IS NOT NULL AND cf.away_score IS NOT NULL
  ),
  form AS (
    SELECT team_id, league_id,
      COUNT(*)                                   AS played,
      COUNT(*) FILTER (WHERE us > them)          AS won,
      COUNT(*) FILTER (WHERE us = them)          AS drawn,
      COUNT(*) FILTER (WHERE us < them)          AS lost,
      COALESCE(SUM(us), 0)                       AS gf,
      COALESCE(SUM(them), 0)                      AS ga,
      COALESCE(SUM(us - them), 0)                AS gd,
      COALESCE(SUM(CASE WHEN us > them THEN 3 WHEN us = them THEN 1 ELSE 0 END), 0) AS points
    FROM played GROUP BY team_id, league_id
  ),
  last5 AS (
    SELECT team_id, league_id, jsonb_agg(r ORDER BY rn DESC) AS chips
    FROM (
      SELECT team_id, league_id,
        (CASE WHEN us > them THEN 'W' WHEN us = them THEN 'D' ELSE 'L' END) AS r,
        row_number() OVER (PARTITION BY team_id, league_id ORDER BY scheduled_date DESC) AS rn
      FROM played
    ) q WHERE rn <= 5 GROUP BY team_id, league_id
  )
  SELECT COALESCE(jsonb_agg(block ORDER BY league_name), '[]'::jsonb)
  INTO v_leagues
  FROM (
    SELECT cl.name AS league_name, jsonb_build_object(
      'league_id',      cl.id,
      'league_name',    cl.name,
      'season_label',   cl.season_label,
      'club_name',      c.name,
      'fa_embed_code',  cl.fa_embed_code,
      'fa_source_url',  cl.fa_source_url,
      'club_team_id',   t.id,
      'club_team_name', t.name,
      'form', jsonb_build_object(
        'played', COALESCE(f.played, 0), 'won', COALESCE(f.won, 0),
        'drawn',  COALESCE(f.drawn, 0),  'lost', COALESCE(f.lost, 0),
        'gf', COALESCE(f.gf, 0), 'ga', COALESCE(f.ga, 0), 'gd', COALESCE(f.gd, 0),
        'points', COALESCE(f.points, 0), 'last5', COALESCE(l5.chips, '[]'::jsonb)
      ),
      'fixtures', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'fixture_id',     cf.id,
          'opponent_name',  cf.opponent_name,
          'is_home',        cf.is_home,
          'scheduled_date', cf.scheduled_date,
          'kickoff_time',   to_char(cf.kickoff_time, 'HH24:MI'),
          'pitch_name',     pa.name,
          'status',         cf.status
        ) ORDER BY cf.scheduled_date, cf.kickoff_time)
        FROM public.club_fixtures cf
        LEFT JOIN public.playing_areas pa ON pa.id = cf.playing_area_id
        WHERE cf.club_team_id = ct.team_id AND cf.league_id = ct.league_id
          AND cf.status = 'scheduled' AND cf.scheduled_date >= v_today
      ), '[]'::jsonb),
      'results', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'fixture_id',     cf.id,
          'opponent_name',  cf.opponent_name,
          'is_home',        cf.is_home,
          'scheduled_date', cf.scheduled_date,
          'home_score',     cf.home_score,
          'away_score',     cf.away_score,
          'status',         cf.status
        ) ORDER BY cf.scheduled_date DESC)
        FROM public.club_fixtures cf
        WHERE cf.club_team_id = ct.team_id AND cf.league_id = ct.league_id
          AND cf.status = 'completed'
      ), '[]'::jsonb)
    ) AS block
    FROM child_teams ct
    JOIN public.club_leagues cl ON cl.id = ct.league_id AND cl.archived_at IS NULL
    JOIN public.clubs        c  ON c.id  = cl.club_id
    JOIN public.club_teams   t  ON t.id  = ct.team_id
    LEFT JOIN form  f  ON f.team_id  = ct.team_id AND f.league_id  = ct.league_id
    LEFT JOIN last5 l5 ON l5.team_id = ct.team_id AND l5.league_id = ct.league_id
  ) blocks;

  RETURN jsonb_build_object(
    'ok', true,
    'child_profile_id', p_child_profile_id,
    'leagues', COALESCE(v_leagues, '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.guardian_list_child_leagues(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.guardian_list_child_leagues(uuid) TO anon, authenticated;
