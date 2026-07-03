-- 475: Match Fitness Stats — two cross-player readers + one detach write RPC (+ U18 read-guard retrofit)
--
-- Phase-2 STATS/TRENDS/SOCIAL layer on the shipped capture pipe (migs 375/456/457).
-- MATCH_FITNESS_STATS_HANDOFF.md, PR #5. NO schema DDL — three CREATE FUNCTIONs + one
-- CREATE OR REPLACE retrofit. All SECURITY DEFINER, search_path pinned, single overload,
-- REVOKE from anon + authenticated + PUBLIC by name then GRANT to authenticated
-- (defeats the default-privileges auto-grant — MEMORY feedback_default_privileges_revoke).
--
-- Tier-3 (RLS + special-category health data + a new WRITE). Drafted by the dev-loop,
-- ephemeral-verified with rollback, APPLIED ONLY after operator sign-off (gate G1).
-- Whole layer ships DARK (display self-hides on empty; attach gates on VITE_HEALTH_KIT_ENABLED).
--
-- Contents:
--   1. get_h2h_match_fitness(p_opponent_player_id, p_period)      — per-opponent compare (anti-probing)
--   2. get_squad_fitness_leaderboard(p_team_id, p_period)         — squad averages + most-improved + min-N floor
--   3. delete_match_health_session(p_client_session_id)           — own-row-only detach (route cascades; audits HR#9)
--   4. get_match_health_for_match(p_match_ref)  RETROFIT          — add the U18 read-guard (LOCKED: readers had none)
--
-- Consent/casual/U18 model — mirrors get_match_health_for_match (mig 456):
--   • auth.uid() identity; anon has no path.
--   • Cross-player rows only for match_context='casual' AND that player's share_match_fitness=true.
--   • Consent re-evaluated on every read (join players.share_match_fitness) — never snapshotted.
--   • Every reader excludes under-18 rows for self AND others (AND NOT _health_is_under_18(s.user_id)) —
--     the readers had NO U18 re-check; a residual row (saved DOB-unknown, DOB<18 entered later) was reachable.
--
-- FUTURE-PROOF (baked in now, expensive later — HR#12/#14): every bucket carries a stable
-- `period_start` ISO date (so ONE reader feeds weekly/monthly/seasonal graphs) AND `source_counts`
-- (watch_app vs apple_health_manual vs unknown) — the sessions array does not carry `source` at the
-- caller today, so retrofitting it later is a return-shape change across five recorded consumers.
--
-- p_period ('month'|'season'|'all', default 'all') MIRRORS the StatsView selector exactly:
--   month  → start of the current calendar month
--   season → start of the current calendar year (StatsView: `${year}-01-01`)
--   all    → no cutoff
-- Storage stays in metres (SI, unit-neutral); the client formats to miles (formatDistance).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_h2h_match_fitness — per-opponent fitness compare over shared casual games.
--    Anti-probing: `them` is populated ONLY when we actually co-played casual games with this
--    opponent (EXISTS a shared player_match) AND the opponent consented AND is 18+. Passing an
--    arbitrary player we never played returns shared_games=0, them=null — never their numbers.
--    `buckets[]` is the CALLER's OWN monthly series across the shared games (the trend line);
--    the opponent's per-month figures are deliberately NOT exposed (only their period aggregate),
--    so a single shared month can't re-identify one exact opponent workout.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_h2h_match_fitness(
  p_opponent_player_id text,
  p_period             text DEFAULT 'all'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id      uuid := auth.uid();
  v_cutoff       timestamptz;
  v_my_pids      text[];
  v_opp_user     uuid;
  v_opp_consent  boolean;
  v_shared       text[];
  v_shared_games int;
  v_me           jsonb;
  v_them         jsonb := NULL;
  v_buckets      jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_opponent_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  v_cutoff := CASE p_period
    WHEN 'month'  THEN date_trunc('month', current_date)
    WHEN 'season' THEN date_trunc('year',  current_date)
    ELSE NULL
  END;

  -- caller's own player rows (they may play in several squads)
  SELECT COALESCE(array_agg(id), ARRAY[]::text[])
    INTO v_my_pids FROM players WHERE user_id = v_user_id;

  -- opponent identity + global consent (single player row → one user_id)
  SELECT user_id, COALESCE(share_match_fitness, false)
    INTO v_opp_user, v_opp_consent
    FROM players WHERE id = p_opponent_player_id LIMIT 1;
  v_opp_consent := COALESCE(v_opp_consent, false);

  -- shared CASUAL match refs: both have a player_match row on the same match. The JOIN to
  -- `matches` restricts to casual games only (matches.id = casual match_ref; league play lives in
  -- `fixtures`, never `matches`), so a league co-appearance can't inflate shared_games.
  SELECT COALESCE(array_agg(DISTINCT pm_me.match_id), ARRAY[]::text[])
    INTO v_shared
    FROM player_match pm_me
    JOIN player_match pm_them ON pm_them.match_id = pm_me.match_id
    JOIN matches m            ON m.id = pm_me.match_id
   WHERE pm_me.player_id = ANY(v_my_pids)
     AND pm_them.player_id = p_opponent_player_id;
  v_shared_games := COALESCE(array_length(v_shared, 1), 0);

  -- me: aggregate my own sessions across the shared games (U18-guarded)
  SELECT jsonb_build_object(
      'games',            count(*),
      'total_distance_m', COALESCE(round(sum(distance_meters)), 0),
      'total_kcal',       COALESCE(round(sum(active_energy_kcal)), 0),
      'avg_distance_m',   COALESCE(round(avg(distance_meters)), 0),
      'avg_kcal',         COALESCE(round(avg(active_energy_kcal)), 0),
      'avg_hr',           COALESCE(round(avg(avg_hr)), 0),
      'max_hr',           COALESCE(max(max_hr), 0)
    ) INTO v_me
    FROM match_health_sessions s
   WHERE s.user_id = v_user_id
     AND s.match_context = 'casual'
     AND s.match_ref = ANY(v_shared)
     AND (v_cutoff IS NULL OR s.started_at >= v_cutoff)
     AND NOT _health_is_under_18(s.user_id);

  -- them: only when we actually share games AND they consented AND are 18+
  IF v_opp_user IS NOT NULL AND v_opp_consent
     AND v_shared_games > 0
     AND NOT _health_is_under_18(v_opp_user) THEN
    SELECT jsonb_build_object(
        'games',            count(*),
        'total_distance_m', COALESCE(round(sum(distance_meters)), 0),
        'total_kcal',       COALESCE(round(sum(active_energy_kcal)), 0),
        'avg_distance_m',   COALESCE(round(avg(distance_meters)), 0),
        'avg_kcal',         COALESCE(round(avg(active_energy_kcal)), 0),
        'avg_hr',           COALESCE(round(avg(avg_hr)), 0),
        'max_hr',           COALESCE(max(max_hr), 0)
      ) INTO v_them
      FROM match_health_sessions s
     WHERE s.user_id = v_opp_user
       AND s.match_context = 'casual'
       AND s.match_ref = ANY(v_shared)
       AND (v_cutoff IS NULL OR s.started_at >= v_cutoff);
  END IF;

  -- buckets: my own monthly series across the shared games (period_start + source_counts)
  SELECT COALESCE(jsonb_agg(q.b ORDER BY q.ps), '[]'::jsonb)
    INTO v_buckets
  FROM (
    SELECT
      date_trunc('month', s.started_at) AS ps,
      jsonb_build_object(
        'period_start', to_char(date_trunc('month', s.started_at), 'YYYY-MM-DD'),
        'games',        count(*),
        'distance_m',   COALESCE(round(sum(s.distance_meters)), 0),
        'kcal',         COALESCE(round(sum(s.active_energy_kcal)), 0),
        'avg_hr',       COALESCE(round(avg(s.avg_hr)), 0),
        'source_counts', jsonb_build_object(
          'watch_app',           count(*) FILTER (WHERE s.source = 'watch_app'),
          'apple_health_manual', count(*) FILTER (WHERE s.source = 'apple_health_manual'),
          'unknown',             count(*) FILTER (WHERE s.source IS NULL)
        )
      ) AS b
    FROM match_health_sessions s
   WHERE s.user_id = v_user_id
     AND s.match_context = 'casual'
     AND s.match_ref = ANY(v_shared)
     AND s.started_at IS NOT NULL
     AND (v_cutoff IS NULL OR s.started_at >= v_cutoff)
     AND NOT _health_is_under_18(s.user_id)
   GROUP BY date_trunc('month', s.started_at)
  ) q;

  RETURN jsonb_build_object(
    'ok',                 true,
    'opponent_consented', v_opp_consent,
    'shared_games',       v_shared_games,
    'me',                 v_me,
    'them',               v_them,
    'buckets',            v_buckets
  );
END;
$function$;

REVOKE ALL ON FUNCTION get_h2h_match_fitness(text, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION get_h2h_match_fitness(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_squad_fitness_leaderboard — the recurring squad's fitness board.
--    Squad = team_players for p_team_id (membership VERIFIED server-side — p_team_id is never a
--    trust signal). Own row ALWAYS; other members ONLY when consented + 18+; casual games scoped
--    to THIS team's matches. Min-N floor (default 3 OTHER consenting members with data): below it,
--    the board collapses to the self row so one teammate's exact numbers can't be re-identified.
--    most_improved_pct = HR trend (earliest→latest month avg_hr; positive = HR down = fitter,
--    LOCKED DECISION #5), null under 2 months of data. Non-watch/roster framing is a UI concern
--    (PR #9) — this reader returns fitness rows only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_squad_fitness_leaderboard(
  p_team_id text,
  p_period  text DEFAULT 'all'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

  -- membership check — never trust p_team_id as a grant
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
    -- distinct account-holding members of this squad (guests/token-only have no health rows)
    SELECT DISTINCT
      p.id                                AS player_id,
      p.user_id                           AS user_id,
      p.name                              AS player_name,
      (p.user_id = v_user_id)             AS is_self,
      COALESCE(p.share_match_fitness,false) AS consented
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = p_team_id
      AND p.user_id IS NOT NULL
      AND NOT _health_is_under_18(p.user_id)   -- U18 fully excluded (self and others)
  ),
  team_matches AS (
    SELECT id FROM matches WHERE team_id = p_team_id
  ),
  member_sessions AS (
    -- one row per (member, session) across THIS squad's casual games, in-period
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

REVOKE ALL ON FUNCTION get_squad_fitness_leaderboard(text, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION get_squad_fitness_leaderboard(text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. delete_match_health_session — the reverse path (LOCKED DECISION #8).
--    Own-row-only DELETE keyed on (auth.uid(), client_session_id): a session belonging to another
--    user simply is NOT FOUND (never deletable). The match_health_routes row cascades away via its
--    ON DELETE CASCADE FK. Writes an audit_events trace (Hard Rule #9). Unblocks the deferred
--    silent-auto-attach-with-undo variant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_match_health_session(
  p_client_session_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id       uuid := auth.uid();
  v_id            uuid;
  v_match_context text;
  v_match_ref     text;
  v_team_id       text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_client_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  -- Own-row-only: scoping on user_id means another user's session is never visible here.
  SELECT id, match_context, match_ref
    INTO v_id, v_match_context, v_match_ref
    FROM match_health_sessions
   WHERE user_id = v_user_id AND client_session_id = p_client_session_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_found';
  END IF;

  -- Route row cascades via match_health_routes.session_id ON DELETE CASCADE (mig 456).
  DELETE FROM match_health_sessions WHERE id = v_id AND user_id = v_user_id;

  -- Audit team_id (Hard Rule #9): real owning team where known, else literal 'health'.
  IF v_match_context = 'casual' THEN
    SELECT team_id INTO v_team_id FROM matches WHERE id = v_match_ref;
  ELSE
    BEGIN
      SELECT home_team_id INTO v_team_id FROM fixtures WHERE id = v_match_ref::uuid;
    EXCEPTION WHEN others THEN v_team_id := NULL;
    END;
  END IF;
  v_team_id := COALESCE(v_team_id, 'health');

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', v_user_id, 'auth_uid:' || v_user_id::text,
    'match_health_deleted', 'match_health_session', v_id::text,
    jsonb_build_object(
      'match_context', v_match_context,
      'match_ref', v_match_ref,
      'client_session_id', p_client_session_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'deleted', true, 'id', v_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION delete_match_health_session(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION delete_match_health_session(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_match_health_for_match — RETROFIT the U18 read-guard.
--    Body is mig 456's verbatim, with ONLY `AND NOT _health_is_under_18(s.user_id)` added to the
--    WHERE so a residual under-18 row (saved DOB-unknown, DOB<18 entered later) can no longer be
--    read for self OR teammates. No other line drifts (HR#11).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_match_health_for_match(p_match_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
      SELECT p.name, p.share_match_fitness
        FROM players p
        JOIN team_players tp ON tp.player_id = p.id
        JOIN matches m       ON m.id = s.match_ref AND m.team_id = tp.team_id
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

REVOKE ALL ON FUNCTION get_match_health_for_match(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION get_match_health_for_match(text) TO authenticated;

-- Refresh PostgREST so the new/changed RPCs resolve immediately (avoids the 404 cache trap).
SELECT pg_notify('pgrst', 'reload schema');
