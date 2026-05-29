-- 173_hq_analytics_rpcs.sql
-- League Mode Phase 6 Cycle 6.3 — composable HQ dashboard (Layer A).
--
-- hq_get_analytics — one read returning every card's dataset + the caller's saved layout,
-- role/region scoped exactly like hq_get_company_state (mig 171). Card keys:
--   overview · venue_comparison · top_scorers · discipline · incidents · billing
-- Datasets are computed only from confirmed sources (fixtures scores, match_events goal/
-- cards, incidents, venues, competition_teams) — no fabricated "% opened app" / standings
-- metrics (no clean source; deferred). Optional p_date_from/p_date_to filter fixtures +
-- match_events (via their fixture's scheduled_date); NULL = all-time.
--
-- hq_set_dashboard_config — per-admin layout write (company_admins.dashboard_config). NOT a
-- company-data mutation — a personal UI preference for the caller's own row — so no audit
-- (hard-rule #9 targets fire-and-forget data writes; this is synchronous + side-effect-free
-- beyond the caller's own pref row).
--
-- CONSUMERS (hard-rule #14): apps/hq AnalyticsView via wrappers hqGetAnalytics /
-- hqSetDashboardConfig. The card registry here is also what the Phase 7 AI layer will
-- compose over (grounded selection from these keys, never raw SQL).

-- ──────────────────────────────────────────────────────────────────
-- hq_get_analytics — composable dashboard datasets + caller layout.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_get_analytics(
  p_company_id text, p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_config jsonb; v_result jsonb;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT dashboard_config INTO v_config
    FROM company_admins WHERE user_id = auth.uid() AND company_id = p_company_id;

  WITH scoped AS (
    SELECT v.id, v.name, v.region, v.subscription_status, v.trial_ends_at
    FROM venues v
    WHERE v.company_id = p_company_id
      AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
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
    )
  ) INTO v_result;

  RETURN jsonb_build_object(
    'analytics', v_result,
    'config', v_config,
    'caller', jsonb_build_object('actor_type', v_actor, 'role', v_role, 'region', v_region),
    'range', jsonb_build_object('from', p_date_from, 'to', p_date_to)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.hq_get_analytics(text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hq_get_analytics(text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.hq_get_analytics(text, date, date) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- hq_set_dashboard_config — per-admin layout write (the caller's own row).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_set_dashboard_config(p_company_id text, p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company_id text; v_role text; v_region text; v_actor text;
  v_known text[] := ARRAY['overview','venue_comparison','top_scorers','discipline','incidents','billing'];
  v_cards jsonb; v_clean jsonb; v_rows int;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- validate shape: keep only known card keys, preserving order; preset is free text or null
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'bad_config';
  END IF;
  SELECT COALESCE(jsonb_agg(c ORDER BY ord), '[]'::jsonb) INTO v_cards
  FROM jsonb_array_elements_text(COALESCE(p_config->'cards','[]'::jsonb)) WITH ORDINALITY AS x(c, ord)
  WHERE c = ANY(v_known);

  v_clean := jsonb_build_object('preset', p_config->'preset', 'cards', v_cards);

  UPDATE company_admins SET dashboard_config = v_clean
   WHERE user_id = auth.uid() AND company_id = p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- platform_admin without a company_admins row has nowhere to persist (preview only)
  RETURN jsonb_build_object('ok', true, 'persisted', v_rows > 0, 'config', v_clean);
END;
$fn$;
REVOKE ALL ON FUNCTION public.hq_set_dashboard_config(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hq_set_dashboard_config(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.hq_set_dashboard_config(text, jsonb) TO authenticated;
