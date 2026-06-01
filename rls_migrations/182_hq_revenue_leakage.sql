-- Migration 182 — HQ-I Phase 2 (Revenue & Leakage) = Venue Payments Ledger V4
--
-- Surfaces the venue_charges/venue_payments ledger (mig 180/181) into HQ:
--   1. _hq_health_score gains a 4th axis (revenue = collection-rate %), weight 0.30.
--      Purely additive — a venue with no charges drops the revenue axis and the
--      remaining axes renormalise exactly as before (never invents a number).
--   2. hq_get_company_state computes a per-venue all-time collection rate and feeds
--      it into the health score; exposes it under health_axes.revenue and as a
--      'revenue' top_reason. Health band/dot now reflects collection discipline.
--   3. hq_get_analytics gains a 'revenue' card dataset: company owed/collected/
--      outstanding/collection_rate + a per-venue breakdown. Region-scoped via the
--      existing `scoped` CTE; optional date filter on charge created_at (mirrors fx).
--
-- Revenue math mirrors venue_get_charges (mig 181) exactly so HQ agrees with the
-- apps/venue Payments screen: owed = SUM(amount_due) over non-refunded charges,
-- collected = SUM(non-voided payment - refund), outstanding = SUM(max(owed-paid,0)),
-- collection_rate = 100*collected/owed (NULL when owed = 0).
--
-- All three rebuilt on their LIVE bodies (pulled via pg_get_functiondef this cycle).
-- No faked revenue in production: production charges = 0 -> revenue shows £0 / rate
-- NULL, the revenue axis drops, scores unchanged. Demo company (demo_venue) shows
-- its seeded ledger. Decisions: revenue weight 0.30, additive (session 64).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. _hq_health_score — 4 axes (param-count change -> DROP old signature first)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._hq_health_score(numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public._hq_health_score(
  p_ops numeric, p_util numeric, p_completion numeric, p_revenue numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  w_ops numeric := 0.40; w_util numeric := 0.30; w_comp numeric := 0.30; w_rev numeric := 0.30;
  tot numeric := 0; acc numeric := 0;
  weakest text := NULL; weakval numeric := 1e9;
BEGIN
  IF p_ops        IS NOT NULL THEN tot := tot + w_ops;  acc := acc + w_ops  * p_ops;        END IF;
  IF p_util       IS NOT NULL THEN tot := tot + w_util; acc := acc + w_util * p_util;       END IF;
  IF p_completion IS NOT NULL THEN tot := tot + w_comp; acc := acc + w_comp * p_completion; END IF;
  IF p_revenue    IS NOT NULL THEN tot := tot + w_rev;  acc := acc + w_rev  * p_revenue;    END IF;
  IF tot = 0 THEN RETURN jsonb_build_object('score', NULL, 'weakest', NULL); END IF;

  IF p_ops        IS NOT NULL AND p_ops        < weakval THEN weakval := p_ops;        weakest := 'operations';        END IF;
  IF p_util       IS NOT NULL AND p_util       < weakval THEN weakval := p_util;       weakest := 'utilisation';       END IF;
  IF p_completion IS NOT NULL AND p_completion < weakval THEN weakval := p_completion; weakest := 'fixture_completion'; END IF;
  IF p_revenue    IS NOT NULL AND p_revenue    < weakval THEN weakval := p_revenue;    weakest := 'revenue';           END IF;

  RETURN jsonb_build_object('score', round(acc / tot), 'weakest', weakest);
END;
$function$;

REVOKE ALL ON FUNCTION public._hq_health_score(numeric, numeric, numeric, numeric) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. hq_get_company_state — revenue axis fed into the health score
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_get_company_state(p_company_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_company jsonb; v_venues jsonb; v_summary jsonb; v_util jsonb;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT to_jsonb(c) INTO v_company FROM (
    SELECT id, name, slug, subscription_status, logo_url, primary_colour, secondary_colour
    FROM companies WHERE id = p_company_id) c;

  SELECT COALESCE(jsonb_object_agg(x.vid, x.pct), '{}'::jsonb) INTO v_util
  FROM (
    SELECT v->>'venue_id' AS vid, v->>'overall_pct' AS pct
    FROM jsonb_array_elements((public.hq_get_utilisation(p_company_id, NULL, NULL))->'venues') v
  ) x;

  WITH scoped AS (
    SELECT v.* FROM venues v
    WHERE v.company_id = p_company_id
      AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
  )
  SELECT COALESCE(jsonb_agg(j ORDER BY j->>'name'), '[]'::jsonb) INTO v_venues
  FROM (
    SELECT jsonb_build_object(
      'id', s.id, 'name', s.name, 'region', s.region,
      'subscription_status', s.subscription_status, 'trial_ends_at', s.trial_ends_at,
      'tonight_fixtures', (
        SELECT count(*) FROM fixtures f
        JOIN competitions cp ON cp.id = f.competition_id
        JOIN seasons se ON se.id = cp.season_id
        JOIN leagues l ON l.id = se.league_id
        WHERE l.venue_id = s.id AND f.scheduled_date = current_date
          AND f.status IN ('scheduled','allocated','in_progress')),
      'open_incidents', c.open_inc,
      'critical_incidents', c.crit_inc,
      'unallocated_this_week', c.unalloc,
      'unassigned_refs_this_week', c.unref,
      'health', d.health,
      'health_score', d.score,
      'health_reason', d.reason,
      'collection_rate', sc.rev_score,
      'health_axes', jsonb_build_object(
        'operations', sc.ops_score,
        'utilisation', sc.util_score,
        'fixture_completion', sc.comp_score,
        'revenue', sc.rev_score)
    ) AS j
    FROM scoped s
    CROSS JOIN LATERAL (
      SELECT
        (SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL) AS open_inc,
        (SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL AND i.severity = 'critical') AS crit_inc,
        (SELECT count(*) FROM fixtures f
           JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
           WHERE l.venue_id = s.id AND f.scheduled_date BETWEEN current_date AND current_date + 7
             AND f.status IN ('scheduled','allocated') AND f.playing_area_id IS NULL) AS unalloc,
        (SELECT count(*) FROM fixtures f
           JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
           WHERE l.venue_id = s.id AND f.scheduled_date BETWEEN current_date AND current_date + 7
             AND f.status IN ('scheduled','allocated') AND f.official_id IS NULL) AS unref,
        (SELECT count(*) FROM fixtures f
           JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
           WHERE l.venue_id = s.id AND f.status = 'completed') AS fx_done,
        (SELECT count(*) FROM fixtures f
           JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
           WHERE l.venue_id = s.id AND f.status IN ('scheduled','allocated','in_progress','postponed')) AS fx_rem
    ) c
    CROSS JOIN LATERAL (
      -- all-time collection rate per venue (mirrors venue_get_charges)
      SELECT COALESCE(SUM(amount_due_pence), 0) AS owed,
             COALESCE(SUM(paid), 0) AS collected
      FROM (
        SELECT c2.amount_due_pence,
               COALESCE((SELECT SUM(CASE WHEN p.kind = 'payment' THEN p.amount_pence ELSE -p.amount_pence END)
                         FROM venue_payments p WHERE p.charge_id = c2.id AND p.voided_at IS NULL), 0) AS paid
        FROM venue_charges c2
        WHERE c2.venue_id = s.id AND c2.status <> 'refunded'
      ) q
    ) rev
    CROSS JOIN LATERAL (
      SELECT
        greatest(0, 100 - c.crit_inc*40 - (c.open_inc - c.crit_inc)*10 - c.unalloc*8 - c.unref*5)::numeric AS ops_score,
        CASE WHEN (v_util->>s.id) IS NULL THEN NULL
             ELSE least(100, (v_util->>s.id)::numeric * 2) END AS util_score,
        CASE WHEN (c.fx_done + c.fx_rem) = 0 THEN NULL
             ELSE round(100.0 * c.fx_done / (c.fx_done + c.fx_rem)) END AS comp_score,
        CASE WHEN rev.owed = 0 THEN NULL
             ELSE least(100, round(100.0 * rev.collected / rev.owed, 1)) END AS rev_score
    ) sc
    CROSS JOIN LATERAL ( SELECT public._hq_health_score(sc.ops_score, sc.util_score, sc.comp_score, sc.rev_score) AS hs ) h
    CROSS JOIN LATERAL (
      SELECT
        (h.hs->>'score')::int AS score,
        CASE
          WHEN c.crit_inc > 0
            OR s.subscription_status IN ('past_due','cancelled')
            OR (s.trial_ends_at IS NOT NULL AND s.trial_ends_at < now()) THEN 'red'
          WHEN (h.hs->>'score')::int >= 80 THEN 'green'
          WHEN (h.hs->>'score')::int >= 55 THEN 'amber'
          ELSE 'red' END AS health,
        CASE
          WHEN c.crit_inc > 0 THEN 'Critical incident open'
          WHEN s.subscription_status IN ('past_due','cancelled') THEN 'Subscription ' || s.subscription_status
          WHEN s.trial_ends_at IS NOT NULL AND s.trial_ends_at < now() THEN 'Trial expired'
          WHEN h.hs->>'weakest' = 'operations' AND c.open_inc > 0 THEN c.open_inc || ' open incident' || CASE WHEN c.open_inc = 1 THEN '' ELSE 's' END
          WHEN h.hs->>'weakest' = 'operations' AND c.unalloc > 0 THEN c.unalloc || ' fixture' || CASE WHEN c.unalloc = 1 THEN '' ELSE 's' END || ' without a pitch'
          WHEN h.hs->>'weakest' = 'operations' AND c.unref > 0 THEN c.unref || ' fixture' || CASE WHEN c.unref = 1 THEN '' ELSE 's' END || ' without a ref'
          WHEN h.hs->>'weakest' = 'utilisation' THEN 'Pitches ' || COALESCE(v_util->>s.id, '0') || '% utilised'
          WHEN h.hs->>'weakest' = 'fixture_completion' THEN sc.comp_score || '% of fixtures completed'
          WHEN h.hs->>'weakest' = 'revenue' THEN 'Collecting ' || COALESCE(sc.rev_score::text, '0') || '% of fees owed'
          ELSE 'Operations, utilisation, fixtures and revenue all healthy' END AS reason
    ) d
  ) sub;

  WITH scoped AS (
    SELECT v.id FROM venues v WHERE v.company_id = p_company_id
      AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
  ), lg AS (SELECT l.id FROM leagues l WHERE l.venue_id IN (SELECT id FROM scoped)),
     se AS (SELECT s.id FROM seasons s WHERE s.league_id IN (SELECT id FROM lg)),
     cp AS (SELECT c.id FROM competitions c WHERE c.season_id IN (SELECT id FROM se))
  SELECT jsonb_build_object(
    'venue_count',      (SELECT count(*) FROM scoped),
    'active_leagues',   (SELECT count(*) FROM leagues l WHERE l.id IN (SELECT id FROM lg) AND l.active = true),
    'active_seasons',   (SELECT count(*) FROM seasons s WHERE s.id IN (SELECT id FROM se) AND s.status = 'active'),
    'registered_teams', (SELECT count(DISTINCT ct.team_id) FROM competition_teams ct WHERE ct.competition_id IN (SELECT id FROM cp)),
    'open_incidents',   (SELECT count(*) FROM incidents i WHERE i.venue_id IN (SELECT id FROM scoped) AND i.resolved_at IS NULL),
    'fixtures_completed',(SELECT count(*) FROM fixtures f WHERE f.competition_id IN (SELECT id FROM cp) AND f.status = 'completed'),
    'fixtures_remaining',(SELECT count(*) FROM fixtures f WHERE f.competition_id IN (SELECT id FROM cp) AND f.status IN ('scheduled','allocated','in_progress','postponed'))
  ) INTO v_summary;

  RETURN jsonb_build_object(
    'company', v_company, 'venues', v_venues, 'summary', v_summary,
    'caller', jsonb_build_object('actor_type', v_actor, 'role', v_role, 'region', v_region));
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. hq_get_analytics — 'revenue' card dataset (company summary + per-venue)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_get_analytics(p_company_id text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  ),
  chg AS (
    -- non-refunded charges for scoped venues, optionally ranged by created_at; mirrors venue_get_charges
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

  RETURN jsonb_build_object(
    'analytics', v_result,
    'config', v_config,
    'caller', jsonb_build_object('actor_type', v_actor, 'role', v_role, 'region', v_region),
    'range', jsonb_build_object('from', p_date_from, 'to', p_date_to)
  );
END;
$function$;
