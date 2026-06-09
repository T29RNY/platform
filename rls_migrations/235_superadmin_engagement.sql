-- 235_superadmin_engagement.sql
-- Granular engagement analytics for the superadmin dashboard's Engagement tab
-- (apps/superadmin/src/views/Engagement.jsx). The explorable, per-squad × per-category
-- counterpart to the lean ops EMAIL digest (mig 234, get_ops_usage_digest) — same
-- "real squads only" scoping, far more detail.
--
-- Auth: is_platform_admin() gated (called with the signed-in admin's JWT from the browser),
-- mirroring superadmin_recent_activity. Read-only. Demo (team_demo%) + demo-company league
-- seed (team_dc%) stripped per Hard Rule #15.
--
-- Buckets every in-window audit_events action into a feature CATEGORY (availability, squad
-- management, team selection, results, POTM, payments, injuries, guests, profile, match
-- lifecycle, opens) so the tab can show what each squad IS and ISN'T doing. Team selection
-- splits AI (Smart Teams writes a balance_score) vs manual (null). Opens split admin vs
-- player area (app_boot metadata.route_type).
--
-- BLIND SPOT (documented, not a bug): audit_events logs WRITES, not VIEWS — "results
-- checked / table viewed" is not captured until the casual app is instrumented to emit
-- view events. When that lands it becomes another category here with no shape change.

CREATE OR REPLACE FUNCTION superadmin_engagement(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH real_teams AS (
    SELECT id, name FROM teams
    WHERE id NOT LIKE 'team_demo%' AND id NOT LIKE 'team_dc%'
  ),
  ev AS (
    SELECT a.*,
      CASE a.action
        WHEN 'app_boot'                  THEN 'opens'
        WHEN 'player_status_set'         THEN 'availability'
        WHEN 'player_status_updated'     THEN 'availability'
        WHEN 'player_added'              THEN 'squad_mgmt'
        WHEN 'player_deleted'            THEN 'squad_mgmt'
        WHEN 'player_disabled'           THEN 'squad_mgmt'
        WHEN 'player_enabled'            THEN 'squad_mgmt'
        WHEN 'player_priority_updated'   THEN 'squad_mgmt'
        WHEN 'player_note_updated'       THEN 'squad_mgmt'
        WHEN 'player_note_updated_self'  THEN 'squad_mgmt'
        WHEN 'player_vc_updated'         THEN 'squad_mgmt'
        WHEN 'admin_reorder_reserves'    THEN 'squad_mgmt'
        WHEN 'group_assigned'            THEN 'squad_mgmt'
        WHEN 'groups_cleared'            THEN 'squad_mgmt'
        WHEN 'match_teams_saved'         THEN 'team_selection'
        WHEN 'match_teams_confirmed'     THEN 'team_selection'
        WHEN 'week_opened'               THEN 'match_lifecycle'
        WHEN 'week_reopened'             THEN 'match_lifecycle'
        WHEN 'match_cancelled'           THEN 'match_lifecycle'
        WHEN 'match_result_saved'        THEN 'results'
        WHEN 'potm_vote_cast_self'       THEN 'potm'
        WHEN 'potm_voting_closed'        THEN 'potm'
        WHEN 'player_paid_confirmed'     THEN 'payments'
        WHEN 'player_paid_reset'         THEN 'payments'
        WHEN 'player_paid_self_declared' THEN 'payments'
        WHEN 'player_injured_self_set'   THEN 'injuries'
        WHEN 'player_injured_updated'    THEN 'injuries'
        WHEN 'guest_player_added_self'   THEN 'guests'
        WHEN 'guest_player_removed_self' THEN 'guests'
        WHEN 'player_nickname_updated_self' THEN 'profile'
        WHEN 'player_joined_team_self'   THEN 'profile'
        WHEN 'push_subscription_registered' THEN 'profile'
        ELSE 'other'
      END AS category
    FROM audit_events a
    JOIN real_teams rt ON rt.id = a.team_id
    WHERE a.created_at::date BETWEEN p_from AND p_to
  ),
  cat_action AS (
    SELECT category, action, count(*) AS n
    FROM ev WHERE category <> 'other'
    GROUP BY category, action
  ),
  cat_summary AS (
    SELECT category, sum(n) AS total,
      jsonb_agg(jsonb_build_object('action', action, 'n', n) ORDER BY n DESC) AS actions
    FROM cat_action GROUP BY category
  ),
  squad_cat AS (
    SELECT team_id, category, count(*) AS n
    FROM ev WHERE category <> 'other'
    GROUP BY team_id, category
  ),
  squad_roll AS (
    SELECT team_id, jsonb_object_agg(category, n) AS counts, sum(n) AS total
    FROM squad_cat GROUP BY team_id
  ),
  last_seen AS (
    SELECT rt.id, rt.name, max(a.created_at) AS last_active
    FROM real_teams rt LEFT JOIN audit_events a ON a.team_id = rt.id
    GROUP BY rt.id, rt.name
  ),
  opens AS (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE metadata->>'route_type' = 'admin')  AS admin,
      count(*) FILTER (WHERE metadata->>'route_type' = 'player') AS player,
      count(DISTINCT COALESCE(actor_user_id::text, actor_identifier)) AS distinct_users
    FROM ev WHERE category = 'opens'
  ),
  teamsel AS (
    SELECT
      count(*) FILTER (WHERE action = 'match_teams_saved')     AS saved,
      count(*) FILTER (WHERE action = 'match_teams_confirmed') AS confirmed,
      count(*) FILTER (WHERE action = 'match_teams_saved' AND metadata->>'balance_score' IS NOT NULL) AS ai,
      count(*) FILTER (WHERE action = 'match_teams_saved' AND metadata->>'balance_score' IS NULL)     AS manual
    FROM ev WHERE category = 'team_selection'
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'squads_total',  (SELECT count(*) FROM real_teams),
    'squads_active', (SELECT count(DISTINCT team_id) FROM ev),
    'total_events',  (SELECT count(*) FROM ev WHERE category <> 'other'),
    'opens',          (SELECT to_jsonb(o) FROM opens o),
    'team_selection', (SELECT to_jsonb(t) FROM teamsel t),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', category, 'total', total, 'actions', actions) ORDER BY total DESC)
      FROM cat_summary), '[]'::jsonb),
    'per_squad', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'team_id', ls.id, 'name', ls.name,
        'last_active', ls.last_active,
        'days_since', CASE WHEN ls.last_active IS NULL THEN NULL
                          ELSE floor(EXTRACT(EPOCH FROM (now() - ls.last_active)) / 86400)::int END,
        'total', COALESCE(sr.total, 0),
        'counts', COALESCE(sr.counts, '{}'::jsonb)
      ) ORDER BY COALESCE(sr.total, 0) DESC, ls.last_active DESC NULLS LAST)
      FROM last_seen ls LEFT JOIN squad_roll sr ON sr.team_id = ls.id), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION superadmin_engagement(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION superadmin_engagement(date, date) TO authenticated;
