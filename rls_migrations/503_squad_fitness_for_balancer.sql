-- 503: Smart Teams Balancer PR #5 — admin-only fitness reader for the second balancing axis
--
-- Returns a per-player NORMALISED 0–1 fitness SCALAR (never raw HR/kcal/distance — data
-- minimisation: raw health stays inside this SECDEF boundary). Feeds the ADMIN-ONLY team
-- balancer as an optional second axis (α·skill + (1−α)·fitness). Depends on PR #4's consent
-- (mig 502 use_fitness_for_balancing) + the DPIA re-sign (new Purpose 3, signed 2026-07-08).
--
-- Auth: admin-token — team_id is derived server-side from teams.admin_token (never trust a passed
-- team_id). A VC-token / non-admin caller resolves to no team → invalid_token → the balancer's
-- coverage gate silently drops the fitness axis (fails safe to skill-only). Anon+authenticated
-- grants (admin-token routes are anon-context) with REVOKE-by-name first (defeats the
-- default-privileges auto-grant — feedback_default_privileges_revoke).
--
-- Cohort (all three gates, re-evaluated every read — never snapshotted):
--   • use_fitness_for_balancing = true   (the NEW balancing consent, NOT share_match_fitness)
--   • NOT _health_is_under_18(user_id)   (adults only; guests have no verified DOB → also excluded)
--   • is_guest = false                    (guests are skill-only, never fitness — LOCKED 5)
--   • ≥ 2 casual games with distance data (below → no reliable scalar → excluded from the map)
--
-- Metric = avg distance/casual-game over THIS team's matches, min–max normalised across the
-- consented-adult cohort → 0–1 (0.5 when the cohort is degenerate / all-equal). A relative
-- work-rate signal; the engine weights it at (1−α)=0.2 so it only nudges.

CREATE OR REPLACE FUNCTION get_squad_fitness_for_balancer(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id   text;
  v_min_games int := 2;
  v_result    jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  WITH members AS (
    SELECT DISTINCT p.id AS player_id, p.user_id
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = v_team_id
      AND p.user_id IS NOT NULL
      AND COALESCE(p.is_guest, false) = false
      AND COALESCE(p.use_fitness_for_balancing, false) = true
      AND NOT _health_is_under_18(p.user_id)
  ),
  team_matches AS (
    SELECT id FROM matches WHERE team_id = v_team_id
  ),
  agg AS (
    SELECT m.player_id,
           avg(s.distance_meters) AS avg_distance,
           count(*)               AS games
    FROM members m
    JOIN match_health_sessions s
      ON s.user_id = m.user_id
     AND s.match_context = 'casual'
     AND s.match_ref IN (SELECT id FROM team_matches)
     AND s.distance_meters IS NOT NULL
    GROUP BY m.player_id
    HAVING count(*) >= v_min_games
  ),
  bounds AS (
    SELECT min(avg_distance) AS lo, max(avg_distance) AS hi FROM agg
  )
  SELECT jsonb_build_object(
    'ok', true,
    'team_id', v_team_id,
    'players', COALESCE(jsonb_agg(jsonb_build_object(
        'player_id', a.player_id,
        'fitness',   CASE WHEN b.hi > b.lo
                          THEN round(((a.avg_distance - b.lo) / (b.hi - b.lo))::numeric, 4)
                          ELSE 0.5 END,
        'games',     a.games
      ) ORDER BY a.player_id), '[]'::jsonb)
  )
  INTO v_result
  FROM agg a CROSS JOIN bounds b;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION get_squad_fitness_for_balancer(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION get_squad_fitness_for_balancer(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
