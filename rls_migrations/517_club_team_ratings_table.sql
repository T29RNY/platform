-- 517: Club Manager epic PR #7a — club team reliability + Smart-Teams reader.
--
-- One coach-auth read RPC that returns, for a coach's own team, the NEUTRAL input
-- shape the shared engines already consume (packages/core/engine/*), so
-- computePlayerRatings + generateBalancedTeams run UNCHANGED (Decision 4: reuse the
-- ENGINES, never the casual TABLES). Plus a per-player reliability (turnout %) — the
-- grassroots coach's core "who shows up" question — computed as a SQL aggregate
-- (reliability is a DB concern, not an engine call; all-time per CLAUDE.md convention).
--
-- Data (post-#8): appearances/goals/POTM from club_fixture_player_stats; W/L/D from
-- club_fixtures (our score = is_home?home:away vs the other); turnout from
-- club_fixture_availability. matchRows carry team_assignment=NULL — club league games
-- are 11-v-opponent with no intra-squad A/B reshuffle, so the Bradley-Terry SKILL axis
-- degenerates by design; computePlayerRatings then leans on goals/POTM/form (documented
-- engine behaviour: a 0-usable-data axis resolves to squad-average 0.5). The balancer is
-- therefore a training/scrimmage-split tool, not a league-XI picker.
--
-- COACH-FACING INTERNAL read: full player names are correct here (a coach managing their
-- own squad needs identities to pick teams). This is NOT the anon public page — the U18
-- name-truncation transform belongs to get_club_public, not here.
--
-- Consumer (HR#14): apps/inorout /hub TeamManagerSquad.jsx (reliability board + balancer).
-- Coach-auth (auth.uid → member_profiles → club_team_managers is_active for p_team_id),
-- SECDEF, search_path pinned, single overload, REVOKE PUBLIC+anon / GRANT authenticated.
-- Read-only → no audit.
CREATE OR REPLACE FUNCTION public.club_manager_get_team_ratings_table(p_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_team_name  text;
  v_teamgames  int;
  v_past_n     int;
  v_players    jsonb;
  v_matchrows  jsonb;
  v_exact      jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile_id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_manager' USING ERRCODE='P0001'; END IF;

  SELECT name INTO v_team_name FROM club_teams WHERE id = p_team_id;
  IF v_team_name IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001'; END IF;

  -- completed fixtures = teamGames (skill-trust denominator for the engine)
  SELECT count(*) INTO v_teamgames FROM club_fixtures
   WHERE club_team_id = p_team_id AND status = 'completed';

  -- Reliability denominator = past, non-void fixtures where availability was ACTUALLY
  -- solicited (≥1 RSVP row across the squad). Counting fixtures the coach never ran the
  -- RSVP flow on would deflate everyone toward 0 and make the headline signal read
  -- "everyone unreliable". So reliability = "of the matches we asked about, your turnout".
  SELECT count(*) INTO v_past_n FROM club_fixtures cf
   WHERE cf.club_team_id = p_team_id AND cf.status <> 'void'
     AND (cf.status = 'completed' OR cf.scheduled_date <= current_date)
     AND EXISTS (SELECT 1 FROM club_fixture_availability fa WHERE fa.fixture_id = cf.id);

  WITH team_fixtures AS (
    SELECT cf.id, cf.scheduled_date,
      CASE WHEN cf.home_score IS NOT NULL AND cf.away_score IS NOT NULL THEN
        CASE WHEN cf.home_score = cf.away_score THEN 'd'
             WHEN (cf.is_home AND cf.home_score > cf.away_score)
               OR (NOT cf.is_home AND cf.away_score > cf.home_score) THEN 'w'
             ELSE 'l' END
      END AS result
    FROM club_fixtures cf
    WHERE cf.club_team_id = p_team_id AND cf.status <> 'void'
  ),
  appear AS (   -- one row per (member, fixture they were in the stats sheet for)
    SELECT s.member_profile_id AS pid, s.fixture_id, tf.result, tf.scheduled_date,
           s.goals, s.is_potm
    FROM club_fixture_player_stats s
    JOIN team_fixtures tf ON tf.id = s.fixture_id
  ),
  agg AS (
    SELECT pid,
           count(*) FILTER (WHERE result IS NOT NULL)            AS played,
           count(*) FILTER (WHERE result = 'w')                  AS wins,
           count(*) FILTER (WHERE result = 'd')                  AS draws,
           count(*) FILTER (WHERE result = 'l')                  AS losses,
           COALESCE(sum(goals), 0)                               AS goals,
           count(*) FILTER (WHERE is_potm)                       AS potm
    FROM appear GROUP BY pid
  ),
  turnout AS (
    SELECT fa.member_profile_id AS pid, count(*) FILTER (WHERE fa.status = 'in') AS in_ct
    FROM club_fixture_availability fa
    JOIN club_fixtures cf ON cf.id = fa.fixture_id
    WHERE cf.club_team_id = p_team_id
      AND (cf.status = 'completed' OR cf.scheduled_date <= current_date)
      AND cf.status <> 'void'
    GROUP BY fa.member_profile_id
  ),
  roster AS (
    SELECT cm.member_profile_id AS pid,
           mp.first_name || COALESCE(' ' || mp.last_name, '') AS name
    FROM club_team_members cm
    JOIN member_profiles mp ON mp.id = cm.member_profile_id
    WHERE cm.team_id = p_team_id AND cm.is_active = true
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'playerId',          r.pid,
      'member_profile_id', r.pid,
      'name',              r.name,
      'played',            COALESCE(a.played, 0),
      'wins',              COALESCE(a.wins, 0),
      'draws',             COALESCE(a.draws, 0),
      'losses',            COALESCE(a.losses, 0),
      'winRate',           CASE WHEN COALESCE(a.played,0) > 0
                                THEN round(100.0 * a.wins / a.played)::int ELSE 0 END,
      'goals',             COALESCE(a.goals, 0),
      'potm',              COALESCE(a.potm, 0),
      'form',              COALESCE((
                              SELECT jsonb_agg(upper(f.result) ORDER BY f.scheduled_date DESC, f.fixture_id)
                              FROM (SELECT ap.result, ap.scheduled_date, ap.fixture_id
                                    FROM appear ap
                                    WHERE ap.pid = r.pid AND ap.result IS NOT NULL
                                    ORDER BY ap.scheduled_date DESC NULLS LAST, ap.fixture_id LIMIT 5) f
                            ), '[]'::jsonb),
      'reliability',       round(100.0 * COALESCE(t.in_ct, 0) / GREATEST(v_past_n, 1))::int,
      'invited',           v_past_n,
      'ranked',            true
    ) ORDER BY round(100.0 * COALESCE(t.in_ct, 0) / GREATEST(v_past_n, 1)) DESC, r.name), '[]'::jsonb)
  INTO v_players
  FROM roster r
  LEFT JOIN agg a ON a.pid = r.pid
  LEFT JOIN turnout t ON t.pid = r.pid;

  -- matchRows for the rating engine (team_assignment NULL → skill axis degrades, by design)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',       ap.pid,
           'match_id',        ap.fixture_id::text,
           'attended',        true,
           'result',          ap.result,
           'goals',           ap.goals,
           'was_motm',        ap.is_potm,
           'team_assignment', NULL
         )), '[]'::jsonb)
  INTO v_matchrows
  FROM (
    SELECT s.member_profile_id AS pid, s.fixture_id, tf.result, s.goals, s.is_potm
    FROM club_fixture_player_stats s
    JOIN (
      SELECT cf.id,
        CASE WHEN cf.home_score IS NOT NULL AND cf.away_score IS NOT NULL THEN
          CASE WHEN cf.home_score = cf.away_score THEN 'd'
               WHEN (cf.is_home AND cf.home_score > cf.away_score)
                 OR (NOT cf.is_home AND cf.away_score > cf.home_score) THEN 'w'
               ELSE 'l' END
        END AS result
      FROM club_fixtures cf WHERE cf.club_team_id = p_team_id AND cf.status <> 'void'
    ) tf ON tf.id = s.fixture_id
    WHERE tf.result IS NOT NULL
  ) ap;

  -- exactMatchIds = fixtures with a real scoreline (goals gate)
  SELECT COALESCE(jsonb_agg(cf.id::text), '[]'::jsonb) INTO v_exact
  FROM club_fixtures cf
  WHERE cf.club_team_id = p_team_id AND cf.status <> 'void'
    AND cf.home_score IS NOT NULL AND cf.away_score IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'team', jsonb_build_object('team_id', p_team_id, 'name', v_team_name),
    'totalGamesInPeriod', v_teamgames,
    'players', v_players,
    'matchRows', v_matchrows,
    'exactMatchIds', v_exact
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_manager_get_team_ratings_table(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_get_team_ratings_table(uuid) TO authenticated;

SELECT pg_notify('pgrst','reload schema');
