-- 234_ops_usage_digest.sql
-- Read-only operator analytics for the casual (In or Out) app. Powers the daily +
-- weekly ops digest emails (api/cron.js opsDailyDigestJob / opsWeeklyDigestJob).
--
-- Operator-only, cron-only: SECURITY DEFINER so the JWT-less service-role cron can read
-- across every squad's audit trail. Returns ONE jsonb blob covering a window [p_from,p_to]
-- (UK calendar dates, inclusive) plus a previous window [p_prev_from,p_prev_to] for the
-- week-on-week delta. NO writes — nothing to ephemeral-verify; this is a pure SELECT.
--
-- Demo/test exclusion: every metric is scoped to real squads only. Two seed families are
-- stripped per Hard Rule #15 — the casual demo (team_demo, team_demo_alpha..echo) AND the
-- demo-company league seed (team_dc_rovers/city/athletic/fc) — plus any _e2e_ rows. Only
-- genuinely onboarded squads remain, so the numbers are real.
--
-- Designed for a second consumer (Hard Rule #14): the Phase 7 Gaffer AI-narration layer
-- will read this same shape to write the prose version of the digest. Any return-shape
-- change must check both cron.js templates AND that future consumer.

CREATE OR REPLACE FUNCTION get_ops_usage_digest(
  p_from      date,
  p_to        date,
  p_prev_from date DEFAULT NULL,
  p_prev_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH real_teams AS (
  SELECT id, name, created_at
  FROM teams
  WHERE id NOT LIKE 'team_demo%'
    AND id NOT LIKE 'team_dc%'
),
-- audit rows in the window, scoped to real squads
win AS (
  SELECT a.*
  FROM audit_events a
  WHERE a.created_at::date BETWEEN p_from AND p_to
    AND a.team_id IN (SELECT id FROM real_teams)
),
prev AS (
  SELECT a.*
  FROM audit_events a
  WHERE p_prev_from IS NOT NULL
    AND a.created_at::date BETWEEN p_prev_from AND p_prev_to
    AND a.team_id IN (SELECT id FROM real_teams)
),
-- last activity per real squad (for dormancy)
last_seen AS (
  SELECT rt.id, rt.name,
         max(a.created_at) AS last_active
  FROM real_teams rt
  LEFT JOIN audit_events a ON a.team_id = rt.id
  GROUP BY rt.id, rt.name
)
SELECT jsonb_build_object(
  'range', jsonb_build_object('from', p_from, 'to', p_to),

  'squads', jsonb_build_object(
    'total',     (SELECT count(*) FROM real_teams),
    'active',    (SELECT count(DISTINCT team_id) FROM win),
    'new', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY created_at)
      FROM real_teams
      WHERE created_at::date BETWEEN p_from AND p_to
    ), '[]'::jsonb)
  ),

  'players', jsonb_build_object(
    'total',         (SELECT count(*) FROM players WHERE team NOT LIKE 'team_demo%' AND team NOT LIKE 'team_dc%'),
    'new',           (SELECT count(*) FROM players
                        WHERE team NOT LIKE 'team_demo%' AND team NOT LIKE 'team_dc%'
                          AND created_at::date BETWEEN p_from AND p_to),
    'disabled_now',  (SELECT count(*) FROM players
                        WHERE team NOT LIKE 'team_demo%' AND team NOT LIKE 'team_dc%' AND disabled IS TRUE),
    'disabled_in_window', (SELECT count(*) FROM win WHERE action = 'player_disabled'),
    'deleted_in_window',  (SELECT count(*) FROM win
                             WHERE action IN ('player_deleted','guest_player_removed_self'))
  ),

  'activity', jsonb_build_object(
    'total_events',  (SELECT count(*) FROM win),
    'app_opens',     (SELECT count(*) FROM win WHERE action = 'app_boot'),
    'active_players',(SELECT count(DISTINCT COALESCE(actor_user_id::text, actor_identifier))
                        FROM win WHERE action = 'app_boot'),
    'availability_marks', (SELECT count(*) FROM win
                             WHERE action IN ('player_status_set','player_status_updated')),
    'bookings',      (SELECT count(*) FROM win WHERE action = 'booking_confirmed'),
    'by_action', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('action', action, 'n', n) ORDER BY n DESC)
      FROM (
        SELECT action, count(*) AS n FROM win
        WHERE action <> 'app_boot'
        GROUP BY action ORDER BY n DESC LIMIT 8
      ) t
    ), '[]'::jsonb)
  ),

  'dormancy', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name,
      'last_active', last_active,
      'days_since', CASE WHEN last_active IS NULL THEN NULL
                        ELSE floor(EXTRACT(EPOCH FROM (now() - last_active)) / 86400)::int END
    ) ORDER BY last_active ASC NULLS FIRST)
    FROM last_seen
  ), '[]'::jsonb),

  'prev', jsonb_build_object(
    'total_events',   (SELECT count(*) FROM prev),
    'active_players', (SELECT count(DISTINCT COALESCE(actor_user_id::text, actor_identifier))
                         FROM prev WHERE action = 'app_boot')
  )
);
$$;

REVOKE ALL ON FUNCTION get_ops_usage_digest(date, date, date, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_ops_usage_digest(date, date, date, date) TO service_role;
