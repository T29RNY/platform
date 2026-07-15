-- 575 — Squad fitness board accepts a SPECIFIC month (Stats month-picker, whole-page retarget).
--
-- The player-facing Stats tab is gaining a month stepper (‹ June 2026 ›) that retargets the whole
-- page to one chosen calendar month. Every other section retargets client-side from data the app
-- already holds, but the SQUAD FITNESS board is server-aggregated (other members' health data never
-- reaches the client — DPIA boundary), so it needs the reader to accept a specific month.
--
-- Change: add an optional p_month_anchor ('YYYY-MM'). When supplied together with p_period='month',
-- the board is scoped to that exact month window [anchor, anchor + 1 month). When NULL (every caller
-- today), behaviour is byte-for-byte the legacy one: current month / current year / all-time, a
-- single lower-bound cutoff.
--
-- ONLY the time window changes. Membership verification, consent (share_match_fitness), the U18
-- exclusion (_health_is_under_18), the min-N cohort floor, the aggregation, the most-improved trend,
-- the buckets, the grants, and the SECURITY DEFINER + pinned search_path posture are all identical to
-- migration 513. most_improved_pct is a cross-MONTH trend (needs n_months >= 2), so a single-month
-- window naturally yields NULL — correct, there is no in-month improvement to claim.
--
-- Adding a parameter creates a NEW overload; a bare (text, text) call would then be ambiguous
-- ("could not choose best candidate function"), so the old 2-arg signature is dropped first and the
-- grants are re-applied to the new 3-arg signature (a DROP clears them).
--
-- Down: drop the 3-arg signature and restore the exact 513 (text, text) function + its grants.

DROP FUNCTION IF EXISTS public.get_squad_fitness_leaderboard(text, text);

CREATE OR REPLACE FUNCTION public.get_squad_fitness_leaderboard(
  p_team_id      text,
  p_period       text DEFAULT 'all'::text,
  p_month_anchor text DEFAULT NULL   -- 'YYYY-MM' → that exact month (with p_period='month'); NULL → legacy
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id   uuid := auth.uid();
  v_from      timestamptz;
  v_to        timestamptz;
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

  -- Time window. A specific month anchor (only meaningful with p_period='month') selects that exact
  -- calendar month; otherwise fall back to the legacy period cutoff (lower bound only, open upper).
  IF p_month_anchor IS NOT NULL AND p_month_anchor ~ '^\d{4}-\d{2}$' AND p_period = 'month' THEN
    v_from := date_trunc('month', to_date(p_month_anchor || '-01', 'YYYY-MM-DD'));
    v_to   := v_from + interval '1 month';
  ELSE
    v_from := CASE p_period
      WHEN 'month'  THEN date_trunc('month', current_date)
      WHEN 'season' THEN date_trunc('year',  current_date)
      ELSE NULL
    END;
    v_to := NULL;
  END IF;

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
     AND (v_from IS NULL OR s.started_at >= v_from)
     AND (v_to   IS NULL OR s.started_at <  v_to)
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

REVOKE ALL ON FUNCTION public.get_squad_fitness_leaderboard(text, text, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.get_squad_fitness_leaderboard(text, text, text) TO authenticated;
