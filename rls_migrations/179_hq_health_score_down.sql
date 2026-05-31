-- Down for migration 179 — revert hq_get_company_state to the categorical
-- red/amber/green health logic (mig pre-179) and drop the _hq_health_score helper.
-- NOTE: this restores the body as it stood before mig 179 (no health_score /
-- health_reason / health_axes fields). Pulled from the live def captured in audit.

CREATE OR REPLACE FUNCTION public.hq_get_company_state(p_company_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_company jsonb; v_venues jsonb; v_summary jsonb;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT to_jsonb(c) INTO v_company FROM (
    SELECT id, name, slug, subscription_status, logo_url, primary_colour, secondary_colour
    FROM companies WHERE id = p_company_id) c;

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
      'open_incidents', (SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL),
      'critical_incidents', (SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL AND i.severity = 'critical'),
      'unallocated_this_week', (
        SELECT count(*) FROM fixtures f
        JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
        WHERE l.venue_id = s.id AND f.scheduled_date BETWEEN current_date AND current_date + 7
          AND f.status IN ('scheduled','allocated') AND f.playing_area_id IS NULL),
      'unassigned_refs_this_week', (
        SELECT count(*) FROM fixtures f
        JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
        WHERE l.venue_id = s.id AND f.scheduled_date BETWEEN current_date AND current_date + 7
          AND f.status IN ('scheduled','allocated') AND f.official_id IS NULL),
      'health', CASE
        WHEN EXISTS (SELECT 1 FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL AND i.severity = 'critical')
          OR s.subscription_status IN ('past_due','cancelled')
          OR (s.trial_ends_at IS NOT NULL AND s.trial_ends_at < now())
          THEN 'red'
        WHEN (SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL) > 0
          OR EXISTS (SELECT 1 FROM fixtures f
                     JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
                     WHERE l.venue_id = s.id AND f.scheduled_date BETWEEN current_date AND current_date + 7
                       AND f.status IN ('scheduled','allocated') AND (f.playing_area_id IS NULL OR f.official_id IS NULL))
          THEN 'amber'
        ELSE 'green' END
    ) AS j
    FROM scoped s
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

DROP FUNCTION IF EXISTS public._hq_health_score(numeric, numeric, numeric);
