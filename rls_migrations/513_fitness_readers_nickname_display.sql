-- 513 — Match Fitness readers show the squad NICKNAME first, falling back to the account name,
-- matching the app's canonical display rule (packages/core/storage/supabase.js: nickname || name).
--
-- Before: get_match_health_for_match and get_squad_fitness_leaderboard surfaced players.name
-- verbatim, so a user whose account name is a username ("rockybram") showed that instead of their
-- squad nickname ("Rocky") on the per-match fitness card, the top-runner line, and the squad
-- fitness board (reported on-device 2026-07-08).
--
-- Fix: both readers now resolve the display name as COALESCE(NULLIF(p.nickname,''), p.name) — the
-- same rule the rest of the app uses. Display-only: the player_name field/shape is unchanged, only
-- its value source. No consent, RLS, U18, team-assignment, or aggregation logic is touched, so the
-- rpc-security posture (SECURITY DEFINER, pinned search_path, single overload, anon/PUBLIC revoked,
-- authenticated-only) is preserved. get_h2h_match_fitness is intentionally NOT changed — it returns
-- no name (the client supplies the opponent's).
--
-- Down: restores the prior p.name source verbatim.

CREATE OR REPLACE FUNCTION public.get_match_health_for_match(p_match_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_rows    jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_match_ref IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.is_self DESC, r.ended_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id                                   AS session_id,
      (s.user_id = v_user_id)                AS is_self,
      COALESCE(disp.name, 'Player')          AS player_name,
      disp.team_assignment                   AS team_assignment,
      s.match_context,
      s.duration_seconds,
      s.active_energy_kcal,
      s.distance_meters,
      s.avg_hr,
      s.max_hr,
      s.hr_zones,
      s.source,
      EXISTS (SELECT 1 FROM match_health_routes mr WHERE mr.session_id = s.id) AS has_route,
      s.started_at,
      s.ended_at
    FROM match_health_sessions s
    LEFT JOIN LATERAL (
      -- nickname first, then account name (app rule: nickname || name)
      SELECT COALESCE(NULLIF(p.nickname, ''), p.name) AS name, p.share_match_fitness, pm.team_assignment
        FROM players p
        JOIN team_players tp ON tp.player_id = p.id
        JOIN matches m       ON m.id = s.match_ref AND m.team_id = tp.team_id
        LEFT JOIN player_match pm ON pm.player_id = p.id AND pm.match_id = s.match_ref
       WHERE p.user_id = s.user_id
       LIMIT 1
    ) disp ON true
    WHERE s.match_ref = p_match_ref
      AND NOT _health_is_under_18(s.user_id)
      AND (
        s.user_id = v_user_id
        OR (s.match_context = 'casual' AND COALESCE(disp.share_match_fitness, false) = true)
      )
  ) r;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_squad_fitness_leaderboard(p_team_id text, p_period text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id   uuid := auth.uid();
  v_cutoff    timestamptz;
  v_is_member boolean;
  v_min_n     int := 3;
  v_result    jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM team_players tp JOIN players p ON p.id = tp.player_id
     WHERE tp.team_id = p_team_id AND p.user_id = v_user_id
  ) INTO v_is_member;
  IF NOT v_is_member THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_a_member';
  END IF;

  v_cutoff := CASE p_period
    WHEN 'month'  THEN date_trunc('month', current_date)
    WHEN 'season' THEN date_trunc('year',  current_date)
    ELSE NULL
  END;

  WITH members AS (
    SELECT DISTINCT
      p.id                                AS player_id,
      p.user_id                           AS user_id,
      COALESCE(NULLIF(p.nickname, ''), p.name) AS player_name,  -- nickname first (app rule: nickname || name)
      (p.user_id = v_user_id)             AS is_self,
      COALESCE(p.share_match_fitness,false) AS consented
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = p_team_id
      AND p.user_id IS NOT NULL
      AND NOT _health_is_under_18(p.user_id)
  ),
  team_matches AS (
    SELECT id FROM matches WHERE team_id = p_team_id
  ),
  member_sessions AS (
    SELECT
      m.player_id,
      s.id                              AS session_id,
      s.distance_meters,
      s.active_energy_kcal,
      s.avg_hr,
      s.max_hr,
      s.source,
      date_trunc('month', s.started_at) AS mon
    FROM members m
    JOIN match_health_sessions s
      ON s.user_id = m.user_id
     AND s.match_context = 'casual'
     AND s.match_ref IN (SELECT id FROM team_matches)
     AND s.started_at IS NOT NULL
     AND (v_cutoff IS NULL OR s.started_at >= v_cutoff)
  ),
  member_agg AS (
    SELECT
      m.player_id, m.player_name, m.is_self, m.consented,
      count(ms.session_id)                             AS games,
      COALESCE(round(avg(ms.distance_meters)), 0)      AS avg_distance,
      COALESCE(round(sum(ms.distance_meters)), 0)      AS total_distance,
      COALESCE(round(avg(ms.active_energy_kcal)), 0)   AS avg_kcal,
      COALESCE(round(avg(ms.avg_hr)), 0)               AS avg_hr
    FROM members m
    LEFT JOIN member_sessions ms ON ms.player_id = m.player_id
    GROUP BY m.player_id, m.player_name, m.is_self, m.consented
  ),
  monthly AS (
    SELECT player_id, mon, avg(avg_hr) AS m_hr
    FROM member_sessions
    WHERE mon IS NOT NULL
    GROUP BY player_id, mon
  ),
  improve AS (
    SELECT
      player_id,
      count(*)                                    AS n_months,
      (array_agg(m_hr ORDER BY mon ASC))[1]       AS first_hr,
      (array_agg(m_hr ORDER BY mon DESC))[1]      AS last_hr
    FROM monthly
    GROUP BY player_id
  ),
  cohort AS (
    SELECT
      (count(*) FILTER (WHERE NOT is_self AND consented AND games > 0) >= v_min_n) AS min_met
    FROM member_agg
  ),
  visible AS (
    SELECT
      a.player_id, a.player_name, a.is_self, a.games,
      a.avg_distance, a.total_distance, a.avg_kcal, a.avg_hr,
      CASE WHEN i.n_months >= 2 AND i.first_hr > 0
           THEN round(((i.first_hr - i.last_hr) / i.first_hr) * 100)
           ELSE NULL END AS most_improved_pct
    FROM member_agg a
    LEFT JOIN improve i ON i.player_id = a.player_id
    CROSS JOIN cohort c
    WHERE a.is_self OR (c.min_met AND a.consented)
  ),
  squad_buckets AS (
    SELECT
      ms.mon AS ps,
      jsonb_build_object(
        'period_start',     to_char(ms.mon, 'YYYY-MM-DD'),
        'games',            count(*),
        'total_distance_m', COALESCE(round(sum(ms.distance_meters)), 0),
        'avg_hr',           COALESCE(round(avg(ms.avg_hr)), 0),
        'source_counts', jsonb_build_object(
          'watch_app',           count(*) FILTER (WHERE ms.source = 'watch_app'),
          'apple_health_manual', count(*) FILTER (WHERE ms.source = 'apple_health_manual'),
          'unknown',             count(*) FILTER (WHERE ms.source IS NULL)
        )
      ) AS b
    FROM member_sessions ms
    JOIN visible vr ON vr.player_id = ms.player_id
    WHERE ms.mon IS NOT NULL
    GROUP BY ms.mon
  )
  SELECT jsonb_build_object(
    'ok',             true,
    'min_cohort_met', (SELECT min_met FROM cohort),
    'rows', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'player_id',        player_id,
          'player_name',      player_name,
          'is_self',          is_self,
          'games',            games,
          'avg_distance',     avg_distance,
          'total_distance',   total_distance,
          'avg_kcal',         avg_kcal,
          'avg_hr',           avg_hr,
          'most_improved_pct', most_improved_pct
        ) ORDER BY games DESC, avg_distance DESC
      ), '[]'::jsonb)
      FROM visible
    ),
    'buckets', (
      SELECT COALESCE(jsonb_agg(b ORDER BY ps), '[]'::jsonb) FROM squad_buckets
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
