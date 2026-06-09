-- 236_superadmin_health.sql
-- Squad-health analytics for the superadmin Health tab (apps/superadmin/src/views/Health.jsx).
-- Four operator questions in one read-only, is_platform_admin()-gated jsonb:
--   funnel       — activation: how far each squad gets (created → week opened → players
--                  responded → teams picked → result recorded), all-time milestones.
--   notification — reach: of each squad's active roster, how many have push and/or a
--                  contact channel (the app lives on reminders; a squad we can't reach is
--                  invisible). Current-state snapshot.
--   install      — stickiness: PWA-installed vs browser, signed-in vs anonymous, from
--                  app_boot metadata over [p_from,p_to].
--   response     — engagement: of each squad's roster, how many marked in/out over the
--                  window (the rest ghosted).
--
-- Real squads only (team_demo% + team_dc% stripped, Hard Rule #15). Read-only — nothing
-- to ephemeral-verify. Mirrors superadmin_recent_activity's guard + grant shape.

CREATE OR REPLACE FUNCTION superadmin_health(p_from date, p_to date)
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
    SELECT id, name, created_at FROM teams
    WHERE id NOT LIKE 'team_demo%' AND id NOT LIKE 'team_dc%'
  ),
  -- ── Activation funnel: first time each squad hit each milestone ──────────────
  milestones AS (
    SELECT a.team_id,
      min(a.created_at) FILTER (WHERE a.action = 'week_opened') AS t_week,
      min(a.created_at) FILTER (WHERE a.action = 'player_status_set') AS t_response,
      min(a.created_at) FILTER (WHERE a.action IN ('match_teams_saved','match_teams_confirmed')) AS t_teams,
      min(a.created_at) FILTER (WHERE a.action = 'match_result_saved') AS t_result
    FROM audit_events a
    JOIN real_teams rt ON rt.id = a.team_id
    GROUP BY a.team_id
  ),
  funnel_squad AS (
    SELECT rt.id, rt.name, rt.created_at,
      m.t_week, m.t_response, m.t_teams, m.t_result,
      (CASE WHEN m.t_result IS NOT NULL THEN 4
            WHEN m.t_teams IS NOT NULL THEN 3
            WHEN m.t_response IS NOT NULL THEN 2
            WHEN m.t_week IS NOT NULL THEN 1
            ELSE 0 END) AS stage
    FROM real_teams rt LEFT JOIN milestones m ON m.team_id = rt.id
  ),
  -- ── Notification reach: active roster vs reachable ──────────────────────────
  -- squad membership is team_players (players.team is the A/B matchday side, NOT the squad).
  -- Reachability = a REAL delivery path, not the notification_channel preference (which
  -- defaults to 'push' for everyone and is meaningless): push subscription, a phone
  -- (SMS/WhatsApp), or a linked account (email via auth.users). The reminder cron falls
  -- back push→email→SMS, so any of the three means we can reach them.
  roster AS (
    SELECT tp.team_id, p.id AS player_id,
      (ps.player_id IS NOT NULL) AS has_push,
      (p.phone IS NOT NULL) AS has_phone,
      (p.user_id IS NOT NULL) AS has_email
    FROM team_players tp
    JOIN real_teams rt ON rt.id = tp.team_id
    JOIN players p ON p.id = tp.player_id
    LEFT JOIN (SELECT DISTINCT player_id FROM push_subscriptions) ps ON ps.player_id = p.id
    WHERE p.disabled IS NOT TRUE AND p.is_guest IS NOT TRUE
  ),
  notif_squad AS (
    SELECT rt.id, rt.name,
      count(r.player_id) AS roster,
      count(*) FILTER (WHERE r.has_push) AS push,
      count(*) FILTER (WHERE r.has_email) AS email,
      count(*) FILTER (WHERE r.has_phone) AS phone,
      count(*) FILTER (WHERE r.has_push OR r.has_email OR r.has_phone) AS reachable
    FROM real_teams rt LEFT JOIN roster r ON r.team_id = rt.id
    GROUP BY rt.id, rt.name
  ),
  -- ── Install / sign-in health (windowed app_boot) ────────────────────────────
  boot AS (
    SELECT a.* FROM audit_events a
    JOIN real_teams rt ON rt.id = a.team_id
    WHERE a.action = 'app_boot' AND a.created_at::date BETWEEN p_from AND p_to
  ),
  -- ── Response / ghost rate (windowed availability vs roster) ─────────────────
  responders AS (
    SELECT a.team_id, count(DISTINCT a.entity_id) AS n
    FROM audit_events a
    JOIN real_teams rt ON rt.id = a.team_id
    WHERE a.action = 'player_status_set' AND a.created_at::date BETWEEN p_from AND p_to
    GROUP BY a.team_id
  ),
  resp_squad AS (
    SELECT rt.id, rt.name,
      (SELECT count(*) FROM team_players tp JOIN players p ON p.id = tp.player_id
        WHERE tp.team_id = rt.id AND p.disabled IS NOT TRUE AND p.is_guest IS NOT TRUE) AS roster,
      COALESCE(r.n, 0) AS responders
    FROM real_teams rt LEFT JOIN responders r ON r.team_id = rt.id
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'funnel', jsonb_build_object(
      'stages', jsonb_build_array(
        jsonb_build_object('key','created','label','Created','count', (SELECT count(*) FROM funnel_squad)),
        jsonb_build_object('key','week','label','Opened a week','count', (SELECT count(*) FROM funnel_squad WHERE stage >= 1)),
        jsonb_build_object('key','response','label','Players responded','count', (SELECT count(*) FROM funnel_squad WHERE stage >= 2)),
        jsonb_build_object('key','teams','label','Teams picked','count', (SELECT count(*) FROM funnel_squad WHERE stage >= 3)),
        jsonb_build_object('key','result','label','Result recorded','count', (SELECT count(*) FROM funnel_squad WHERE stage >= 4))
      ),
      'per_squad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'team_id', id, 'name', name, 'stage', stage,
          'days_old', floor(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int,
          'days_to_result', CASE WHEN t_result IS NULL THEN NULL
                                 ELSE floor(EXTRACT(EPOCH FROM (t_result - created_at)) / 86400)::int END
        ) ORDER BY created_at DESC)
        FROM funnel_squad), '[]'::jsonb)
    ),
    'notification', jsonb_build_object(
      'roster_total',    (SELECT COALESCE(sum(roster),0) FROM notif_squad),
      'reachable_total', (SELECT COALESCE(sum(reachable),0) FROM notif_squad),
      'push_total',      (SELECT COALESCE(sum(push),0) FROM notif_squad),
      'email_total',     (SELECT COALESCE(sum(email),0) FROM notif_squad),
      'phone_total',     (SELECT COALESCE(sum(phone),0) FROM notif_squad),
      'per_squad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'team_id', id, 'name', name, 'roster', roster, 'push', push, 'email', email, 'phone', phone, 'reachable', reachable
        ) ORDER BY roster DESC)
        FROM notif_squad), '[]'::jsonb)
    ),
    'install', (SELECT jsonb_build_object(
      'opens', count(*),
      'pwa_installed', count(*) FILTER (WHERE metadata->>'display_mode' = 'standalone'),
      'browser', count(*) FILTER (WHERE metadata->>'display_mode' IS DISTINCT FROM 'standalone'),
      'signed_in', count(*) FILTER (WHERE metadata->>'session_present_client' = 'true'),
      'anonymous', count(*) FILTER (WHERE metadata->>'session_present_client' IS DISTINCT FROM 'true'),
      'distinct_users', count(DISTINCT COALESCE(actor_user_id::text, actor_identifier))
    ) FROM boot),
    'response', jsonb_build_object(
      'roster_total',     (SELECT COALESCE(sum(roster),0) FROM resp_squad),
      'responders_total', (SELECT COALESCE(sum(LEAST(responders, roster)),0) FROM resp_squad),
      'per_squad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'team_id', id, 'name', name, 'roster', roster,
          'responders', LEAST(responders, roster),
          'rate', CASE WHEN roster = 0 THEN NULL ELSE round(100.0 * LEAST(responders, roster) / roster)::int END
        ) ORDER BY roster DESC)
        FROM resp_squad), '[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION superadmin_health(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION superadmin_health(date, date) TO authenticated;
