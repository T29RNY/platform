-- mig 190 — hq_get_analytics_for_company (service-role read RPC for the HQ weekly digest cron)
--
-- Service-role sibling of hq_get_analytics (mig 173/182). The auth-gated hq_get_analytics
-- resolves the caller via resolve_company_caller() → auth.uid(), which a cron (service role,
-- no JWT) does not have. This variant drops caller resolution + region scoping (company-wide)
-- + the dashboard_config read, and returns just the analytics jsonb. Precedent: mig 126
-- admin_go_live_for_team (service-role sibling of admin_go_live).
--
-- READ-ONLY. SECURITY DEFINER. service-role-only (anon + authenticated + PUBLIC REVOKED).
-- Consumer: apps/inorout/api/cron.js weeklyDigestJob (Phase 9 HQ weekly digest).

CREATE OR REPLACE FUNCTION public.hq_get_analytics_for_company(
  p_company_id text,
  p_date_from date DEFAULT NULL::date,
  p_date_to   date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH scoped AS (
    SELECT v.id, v.name, v.region, v.subscription_status, v.trial_ends_at
    FROM venues v
    WHERE v.company_id = p_company_id
  ),
  fx AS (
    SELECT f.id, f.status, f.home_score, f.away_score, f.scheduled_date,
           sv.id AS venue_id, sv.name AS venue_name
    FROM fixtures f
    JOIN competitions cp ON cp.id = f.competition_id
    JOIN seasons se ON se.id = cp.season_id
    JOIN leagues l ON l.id = se.league_id
    JOIN scoped sv ON sv.id = l.venue_id
    WHERE (p_date_from IS NULL OR f.scheduled_date >= p_date_from)
      AND (p_date_to   IS NULL OR f.scheduled_date <= p_date_to)
  ),
  ev AS (
    SELECT me.event_type, me.player_id, me.player_name_override, me.team_id, fx.venue_name
    FROM match_events me JOIN fx ON fx.id = me.fixture_id
  ),
  chg AS (
    SELECT c.venue_id, c.amount_due_pence,
           COALESCE((SELECT SUM(CASE WHEN p.kind = 'payment' THEN p.amount_pence ELSE -p.amount_pence END)
                     FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid
    FROM venue_charges c
    JOIN scoped sv ON sv.id = c.venue_id
    WHERE c.status <> 'refunded'
      AND (p_date_from IS NULL OR c.created_at::date >= p_date_from)
      AND (p_date_to   IS NULL OR c.created_at::date <= p_date_to)
  )
  SELECT jsonb_build_object(
    'overview', jsonb_build_object(
      'venues',             (SELECT count(*) FROM scoped),
      'active_leagues',     (SELECT count(*) FROM leagues l WHERE l.venue_id IN (SELECT id FROM scoped) AND l.active),
      'active_seasons',     (SELECT count(*) FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.venue_id IN (SELECT id FROM scoped) AND s.status='active'),
      'registered_teams',   (SELECT count(DISTINCT ct.team_id) FROM competition_teams ct
                             JOIN competitions cp ON cp.id=ct.competition_id JOIN seasons se ON se.id=cp.season_id
                             JOIN leagues l ON l.id=se.league_id WHERE l.venue_id IN (SELECT id FROM scoped)),
      'fixtures_completed', (SELECT count(*) FROM fx WHERE status='completed'),
      'fixtures_remaining', (SELECT count(*) FROM fx WHERE status IN ('scheduled','allocated','in_progress','postponed')),
      'total_goals',        (SELECT COALESCE(sum(COALESCE(home_score,0)+COALESCE(away_score,0)),0) FROM fx WHERE status='completed'),
      'avg_goals_per_game', (SELECT CASE WHEN count(*) FILTER (WHERE status='completed')=0 THEN 0
                               ELSE round(COALESCE(sum(COALESCE(home_score,0)+COALESCE(away_score,0)) FILTER (WHERE status='completed'),0)::numeric
                                          / count(*) FILTER (WHERE status='completed'), 2) END FROM fx)
    ),
    'venue_comparison', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'venue', sv.name, 'region', sv.region,
        'leagues', (SELECT count(*) FROM leagues l WHERE l.venue_id=sv.id),
        'teams',   (SELECT count(DISTINCT ct.team_id) FROM competition_teams ct
                    JOIN competitions cp ON cp.id=ct.competition_id JOIN seasons se ON se.id=cp.season_id
                    JOIN leagues l ON l.id=se.league_id WHERE l.venue_id=sv.id),
        'fixtures_completed', (SELECT count(*) FROM fx WHERE fx.venue_id=sv.id AND fx.status='completed'),
        'fixtures_total',     (SELECT count(*) FROM fx WHERE fx.venue_id=sv.id),
        'completion_pct', (SELECT CASE WHEN count(*)=0 THEN NULL
                             ELSE round(100.0*count(*) FILTER (WHERE status='completed')/count(*),0) END
                           FROM fx WHERE fx.venue_id=sv.id),
        'open_incidents', (SELECT count(*) FROM incidents i WHERE i.venue_id=sv.id AND i.resolved_at IS NULL)
      ) ORDER BY sv.name), '[]'::jsonb) FROM scoped sv
    ),
    'top_scorers', (
      SELECT COALESCE(jsonb_agg(row_to_json(ts)), '[]'::jsonb) FROM (
        SELECT COALESCE(p.name, ev.player_name_override, 'Unknown') AS player,
               t.name AS team, ev.venue_name AS venue, count(*) AS goals
        FROM ev
        LEFT JOIN players p ON p.id = ev.player_id
        LEFT JOIN teams t ON t.id = ev.team_id
        WHERE ev.event_type='goal'
        GROUP BY COALESCE(p.name, ev.player_name_override, 'Unknown'), t.name, ev.venue_name
        ORDER BY count(*) DESC, player ASC LIMIT 15
      ) ts
    ),
    'discipline', (
      SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb) FROM (
        SELECT COALESCE(p.name, ev.player_name_override, 'Unknown') AS player,
               t.name AS team,
               count(*) FILTER (WHERE ev.event_type='yellow_card') AS yellows,
               count(*) FILTER (WHERE ev.event_type='red_card') AS reds
        FROM ev
        LEFT JOIN players p ON p.id = ev.player_id
        LEFT JOIN teams t ON t.id = ev.team_id
        WHERE ev.event_type IN ('yellow_card','red_card')
        GROUP BY COALESCE(p.name, ev.player_name_override, 'Unknown'), t.name
        ORDER BY (count(*) FILTER (WHERE ev.event_type='red_card')) DESC,
                 (count(*) FILTER (WHERE ev.event_type='yellow_card')) DESC LIMIT 15
      ) d
    ),
    'incidents', jsonb_build_object(
      'critical', (SELECT count(*) FROM incidents i WHERE i.venue_id IN (SELECT id FROM scoped) AND i.resolved_at IS NULL AND i.severity='critical'),
      'warning',  (SELECT count(*) FROM incidents i WHERE i.venue_id IN (SELECT id FROM scoped) AND i.resolved_at IS NULL AND i.severity='warning'),
      'info',     (SELECT count(*) FROM incidents i WHERE i.venue_id IN (SELECT id FROM scoped) AND i.resolved_at IS NULL AND i.severity='info')
    ),
    'billing', (
      SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) FROM (
        SELECT subscription_status AS status, count(*) AS n FROM scoped GROUP BY subscription_status
      ) b
    ),
    'revenue', jsonb_build_object(
      'owed_pence',        (SELECT COALESCE(SUM(amount_due_pence),0) FROM chg),
      'collected_pence',   (SELECT COALESCE(SUM(paid),0) FROM chg),
      'outstanding_pence', (SELECT COALESCE(SUM(GREATEST(amount_due_pence - paid, 0)),0) FROM chg),
      'collection_rate',   (SELECT CASE WHEN COALESCE(SUM(amount_due_pence),0)=0 THEN NULL
                              ELSE round(100.0 * SUM(paid) / SUM(amount_due_pence), 1) END FROM chg),
      'by_venue', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'venue', sv.name, 'region', sv.region,
          'owed_pence', x.owed, 'collected_pence', x.collected,
          'outstanding_pence', x.outstanding, 'collection_rate', x.rate
        ) ORDER BY sv.name), '[]'::jsonb)
        FROM scoped sv
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(amount_due_pence),0) AS owed,
                 COALESCE(SUM(paid),0) AS collected,
                 COALESCE(SUM(GREATEST(amount_due_pence - paid, 0)),0) AS outstanding,
                 CASE WHEN COALESCE(SUM(amount_due_pence),0)=0 THEN NULL
                      ELSE round(100.0 * SUM(paid) / SUM(amount_due_pence), 1) END AS rate
          FROM chg WHERE chg.venue_id = sv.id
        ) x
      )
    )
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.hq_get_analytics_for_company(text, date, date) FROM PUBLIC, anon, authenticated;
