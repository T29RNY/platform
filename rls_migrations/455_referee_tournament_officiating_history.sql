-- 455_referee_tournament_officiating_history.sql
-- REFEREE epic — owed follow-up: the tournament arm of officiating HISTORY.
--
-- mig 441 gave get_my_officiating_history two arms (league + casual). mig 443 added
-- LIVE+UPCOMING tournament officiating (get_my_tournament_assignments) but DELIBERATELY
-- deferred completed tournament games ("get_my_officiating_history stays league+casual
-- this PR" — the demo ref had no completed tournament games). This closes that gap.
--
-- Adds a THIRD CTE (tournament_arm) to get_my_officiating_history, identical per-game
-- shape to the existing league arm so the UNION ALL is type-clean and the RefFixtures
-- "Past" list renders it with no frontend change:
--   • league      → fixtures.status='completed', sides reference teams
--   • casual      → matches.winner IS NOT NULL
--   • tournament  → fixtures.status='completed' AND home_competition_team_id IS NOT NULL,
--                   sides reference competition_teams (context='tournament')
--
-- No overlap / no double-count: the league arm INNER-JOINs teams ht ON ht.id =
-- f.home_team_id, which is NULL for tournament fixtures, so they were already invisible
-- to it — the new arm is purely additive. Venue resolved exactly like mig 443's
-- tournament_arm: COALESCE(playing_area→venue, tournament_event→venue, official→venue).
--
-- Same signature (int) → CREATE OR REPLACE, no DROP, no new overload. Read-only, STABLE,
-- SECURITY DEFINER, authenticated-only. No write → no audit_events, no EV.
-- Consumer: apps/inorout RefFixtures.jsx (Past section) — shape unchanged. RPCS.md updated.

-- ─── get_my_officiating_history — now league + casual + tournament ────────────
CREATE OR REPLACE FUNCTION public.get_my_officiating_history(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_person uuid;
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_games  jsonb;
  v_count  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person FROM public.people WHERE auth_user_id = v_uid;
  IF v_person IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'game_count', 0, 'games', '[]'::jsonb);
  END IF;

  WITH fixture_arm AS (
    SELECT
      'league'::text AS context,
      'referee'::text AS role,
      f.ref_token,
      f.id::text AS game_id,
      ((f.scheduled_date + COALESCE(f.kickoff_time, time '00:00'))
         AT TIME ZONE 'Europe/London') AS kickoff_at,
      f.status,
      false AS is_in_progress,
      COALESCE(va.name, mv.name) AS venue_name,
      ht.name AS home_team,
      at.name AS away_team,
      NULL::text AS squad_name,
      f.home_score,
      f.away_score
    FROM public.fixtures f
    JOIN public.match_officials mo ON mo.id = f.official_id AND mo.person_id = v_person
    JOIN public.teams ht ON ht.id = f.home_team_id
    LEFT JOIN public.teams at ON at.id = f.away_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.venues va ON va.id = pa.venue_id
    LEFT JOIN public.venues mv ON mv.id = mo.venue_id
    WHERE f.status = 'completed'
  ),
  casual_arm AS (
    SELECT
      'casual'::text AS context,
      'referee'::text AS role,
      m.ref_token,
      m.id::text AS game_id,
      COALESCE(s.game_date_time, m.match_date::timestamptz) AS kickoff_at,
      'completed'::text AS status,
      false AS is_in_progress,
      s.venue AS venue_name,
      'Team A'::text AS home_team,
      'Team B'::text AS away_team,
      t.name AS squad_name,
      m.score_a AS home_score,
      m.score_b AS away_score
    FROM public.matches m
    JOIN public.players p ON p.id = m.ref_player_id AND p.person_id = v_person
    JOIN public.teams t ON t.id = m.team_id
    LEFT JOIN public.schedule s ON s.active_match_id = m.id
    WHERE m.winner IS NOT NULL
      AND COALESCE(m.cancelled, false) = false
  ),
  tournament_arm AS (
    SELECT
      'tournament'::text AS context,
      'referee'::text    AS role,
      f.ref_token,
      f.id::text         AS game_id,
      ((f.scheduled_date + COALESCE(f.kickoff_time, time '00:00'))
         AT TIME ZONE 'Europe/London') AS kickoff_at,
      f.status,
      false              AS is_in_progress,
      COALESCE(va.name, tv.name, mv.name) AS venue_name,
      ht.team_name       AS home_team,
      att.team_name      AS away_team,
      NULL::text         AS squad_name,
      f.home_score,
      f.away_score
    FROM public.fixtures f
    JOIN public.match_officials mo ON mo.id = f.official_id AND mo.person_id = v_person
    JOIN public.competitions c ON c.id = f.competition_id AND c.tournament_event_id IS NOT NULL
    JOIN public.tournament_events te ON te.id = c.tournament_event_id
    LEFT JOIN public.competition_teams ht  ON ht.id  = f.home_competition_team_id
    LEFT JOIN public.competition_teams att ON att.id = f.away_competition_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.venues va ON va.id = pa.venue_id
    LEFT JOIN public.venues tv ON tv.id = te.venue_id
    LEFT JOIN public.venues mv ON mv.id = mo.venue_id
    WHERE f.home_competition_team_id IS NOT NULL
      AND f.status = 'completed'
  ),
  unioned AS (
    SELECT * FROM fixture_arm
    UNION ALL
    SELECT * FROM casual_arm
    UNION ALL
    SELECT * FROM tournament_arm
  ),
  ordered AS (
    SELECT u.*,
           row_number() OVER (ORDER BY kickoff_at DESC NULLS LAST) AS rn
    FROM unioned u
    ORDER BY kickoff_at DESC NULLS LAST
    LIMIT v_limit
  )
  SELECT
    coalesce(jsonb_agg((to_jsonb(o) - 'rn') ORDER BY o.rn), '[]'::jsonb),
    count(*)
  INTO v_games, v_count
  FROM ordered o;

  RETURN jsonb_build_object(
    'ok', true,
    'game_count', v_count,
    'games', v_games
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_officiating_history(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_officiating_history(int) TO authenticated;

-- ─── Demo seed — one completed tournament game for the demo referee ──────────
-- mig 443 reassigned the demo cup's LIVE final + an upcoming play-off to the demo ref
-- (official 70000000-…-640) but left him with no COMPLETED tournament game, so the new
-- tournament history arm had nothing to render for the demo. Seed one terminal cup
-- fixture (Riverside Reds v Garden Greens, comp 70000000-…-020 = the knockout), scored,
-- official 640. Additive + idempotent; the _down removes it.
INSERT INTO public.fixtures
  (id, competition_id, home_competition_team_id, away_competition_team_id,
   week_number, round_name, scheduled_date, kickoff_time, slot_minutes,
   status, official_id, ref_token, actual_kickoff_at, home_score, away_score)
VALUES
  ('70000000-0000-4000-8000-000000000646',
   '70000000-0000-4000-8000-000000000020',          -- Knockout competition (k_ko)
   '70000000-0000-4000-8000-000000000201',          -- Riverside Reds
   '70000000-0000-4000-8000-000000000202',          -- Garden Greens
   2, 'Quarter-final',
   ((now() AT TIME ZONE 'Europe/London')::date - 5), '13:00:00', 20,
   'completed', '70000000-0000-4000-8000-000000000640', 'ref_demo_tour_done1',
   ((now() AT TIME ZONE 'Europe/London')::date - 5) + time '13:00', 4, 2)
ON CONFLICT (id) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');
