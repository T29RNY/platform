-- Migration 179 — HQ Intelligence Phase 1 Cycle 4: Health Score /100 + top reason.
-- Upgrades the categorical red/amber/green dot in hq_get_company_state into a
-- transparent scored model. Built only from data that exists today.
--
-- Model (operator-locked, session 62):
--   Three axes, each scored 0-100:
--     • operations        = 100 − 40·critical − 10·(open−critical) − 8·unallocated
--                                 − 5·unassigned_refs, floored at 0. Always present.
--     • utilisation       = min(100, overall_pct × 2)  [50% used = full marks].
--                           NULL (axis absent) when the venue has no measurable
--                           utilisation (no active pitches). Source: hq_get_utilisation.
--     • fixture_completion= round(100 · completed / (completed + remaining)).
--                           NULL when the venue has no fixtures yet.
--   Weights: ops 0.40 / util 0.30 / completion 0.30. A missing axis is dropped and
--   the remaining weights renormalised (never invents a number) — _hq_health_score.
--   Band: score ≥80 green · ≥55 amber · else red.
--   HARD-RED overrides (force red + own reason, regardless of score): a critical
--   incident open, subscription past_due/cancelled, or an expired trial — carried
--   over from the original categorical logic.
--   top reason = the weakest present axis, phrased for a human (override reason wins).
--
-- Explicitly NOT yet weighed: revenue, churn (no data). Stated in roadmap, not faked.
--
-- Return-shape additions (additive — hard-rule #12): each venue gains
--   health_score int|null, health_reason text, health_axes {operations,
--   utilisation, fixture_completion}. The existing `health` field stays (now
--   derived from the band + overrides). Consumer: apps/hq VenueHealthGrid.
--
-- Read-only (no audit/broadcast). SECDEF, search_path pinned, anon-denied,
-- region-scoped via resolve_company_caller — all unchanged. Internally calls
-- hq_get_utilisation once for the per-venue overall_pct map (NOTE: recomputes the
-- 28-day bucket grid on every dashboard load; fine at current scale, candidate for
-- a shared util-pct helper later).

-- ── helper: weighted, renormalised /100 score across present axes ──────────────
CREATE OR REPLACE FUNCTION public._hq_health_score(
  p_ops numeric, p_util numeric, p_completion numeric
)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  w_ops numeric := 0.40; w_util numeric := 0.30; w_comp numeric := 0.30;
  tot numeric := 0; acc numeric := 0;
  weakest text := NULL; weakval numeric := 1e9;
BEGIN
  IF p_ops        IS NOT NULL THEN tot := tot + w_ops;  acc := acc + w_ops  * p_ops;        END IF;
  IF p_util       IS NOT NULL THEN tot := tot + w_util; acc := acc + w_util * p_util;       END IF;
  IF p_completion IS NOT NULL THEN tot := tot + w_comp; acc := acc + w_comp * p_completion; END IF;
  IF tot = 0 THEN RETURN jsonb_build_object('score', NULL, 'weakest', NULL); END IF;

  IF p_ops        IS NOT NULL AND p_ops        < weakval THEN weakval := p_ops;        weakest := 'operations';         END IF;
  IF p_util       IS NOT NULL AND p_util       < weakval THEN weakval := p_util;       weakest := 'utilisation';        END IF;
  IF p_completion IS NOT NULL AND p_completion < weakval THEN weakval := p_completion; weakest := 'fixture_completion'; END IF;

  RETURN jsonb_build_object('score', round(acc / tot), 'weakest', weakest);
END;
$function$;

REVOKE ALL ON FUNCTION public._hq_health_score(numeric, numeric, numeric) FROM PUBLIC;

-- ── hq_get_company_state — health upgraded to scored model ─────────────────────
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

  -- per-venue overall utilisation %, keyed by venue_id (text → cast later).
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
      'health_axes', jsonb_build_object(
        'operations', sc.ops_score,
        'utilisation', sc.util_score,
        'fixture_completion', sc.comp_score)
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
      SELECT
        greatest(0, 100 - c.crit_inc*40 - (c.open_inc - c.crit_inc)*10 - c.unalloc*8 - c.unref*5)::numeric AS ops_score,
        CASE WHEN (v_util->>s.id) IS NULL THEN NULL
             ELSE least(100, (v_util->>s.id)::numeric * 2) END AS util_score,
        CASE WHEN (c.fx_done + c.fx_rem) = 0 THEN NULL
             ELSE round(100.0 * c.fx_done / (c.fx_done + c.fx_rem)) END AS comp_score
    ) sc
    CROSS JOIN LATERAL ( SELECT public._hq_health_score(sc.ops_score, sc.util_score, sc.comp_score) AS hs ) h
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
          ELSE 'Operations, utilisation and fixtures all healthy' END AS reason
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
