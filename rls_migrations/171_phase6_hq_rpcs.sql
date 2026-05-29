-- 171_phase6_hq_rpcs.sql
-- League Mode Phase 6 (HQ Dashboard) Cycle 6.1 — caller resolution + company-state read
-- RPCs + venue drill-down + incident resolve (write).
--
-- HQ is authenticated-only (OAuth), no token (scope 6A) — unlike the venue app. A company
-- admin is resolved from auth.uid() against company_admins; a platform_admin (mig 045) is a
-- super_admin override over any company. Role scoping: super_admin = all company venues;
-- regional_admin = own region only (venues.region, mig 169); analyst = read-only (rejected by
-- hq_resolve_incident). The fixture→venue rollup is fixtures→competitions→seasons→leagues.venue_id.
--
-- CONSUMERS (hard-rule #14): apps/hq (cycle 6.1 — VenueHealthGrid, VenueDetail, AlertsActions)
-- via the packages/core wrappers companyAdminWhoami / hqGetCompanyState / hqGetVenueDetail /
-- hqResolveIncident. hq_get_company_state's `summary` shape is also the basis for the Phase 6.3
-- analytics Overview tab + the deferred Phase 9 HQ weekly digest — a return-shape change there
-- must update those consumers.

-- ──────────────────────────────────────────────────────────────────
-- 0. audit_events.actor_type — add 'company_admin' (mig 088/092 bug class:
--    an actor_type absent from the CHECK makes every audit INSERT fail).
--    platform_admin is already present (mig 092).
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_actor_type_check
  CHECK (actor_type = ANY (ARRAY[
    'team_admin','vice_captain','club_admin','super_admin','player','service_role',
    'system','venue_admin','league_admin','platform_admin','referee','company_admin'
  ]));

-- ──────────────────────────────────────────────────────────────────
-- 1. resolve_company_caller — auth.uid() → company_admins; platform_admin override.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_company_caller(p_company_id text)
RETURNS TABLE(company_id text, actor_type text, role text, region text)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Stage 1: a company_admins row for this user on this company
  RETURN QUERY
    SELECT ca.company_id, 'company_admin'::text, ca.role, ca.region
    FROM company_admins ca
    WHERE ca.user_id = v_uid AND ca.company_id = p_company_id
    LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Stage 2: platform admin (mig 045) — super_admin over any company, no region limit
  IF public.is_platform_admin() THEN
    RETURN QUERY SELECT p_company_id, 'platform_admin'::text, 'super_admin'::text, NULL::text;
    RETURN;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.resolve_company_caller(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_company_caller(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_company_caller(text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 2. company_admin_whoami — the HQ app's gate (mirrors superadmin_whoami).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.company_admin_whoami()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_email text; v_companies jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('signed_in', false);
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'company_id', ca.company_id,
            'name',       c.name,
            'role',       ca.role,
            'region',     ca.region) ORDER BY c.name), '[]'::jsonb)
    INTO v_companies
    FROM company_admins ca JOIN companies c ON c.id = ca.company_id
    WHERE ca.user_id = v_uid;

  -- platform admins with no explicit company_admins row see every active company as super_admin
  IF public.is_platform_admin() AND v_companies = '[]'::jsonb THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'company_id', c.id, 'name', c.name,
              'role', 'super_admin', 'region', NULL) ORDER BY c.name), '[]'::jsonb)
      INTO v_companies FROM companies c WHERE c.active = true;
  END IF;

  RETURN jsonb_build_object(
    'signed_in',         true,
    'user_id',           v_uid,
    'email',             v_email,
    'is_platform_admin', public.is_platform_admin(),
    'companies',         v_companies
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.company_admin_whoami() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.company_admin_whoami() FROM anon;
GRANT EXECUTE ON FUNCTION public.company_admin_whoami() TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 3. hq_get_company_state — venue health grid + light company summary.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_get_company_state(p_company_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
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
      'id', s.id,
      'name', s.name,
      'region', s.region,
      'subscription_status', s.subscription_status,
      'trial_ends_at', s.trial_ends_at,
      'tonight_fixtures', (
        SELECT count(*) FROM fixtures f
        JOIN competitions cp ON cp.id = f.competition_id
        JOIN seasons se ON se.id = cp.season_id
        JOIN leagues l ON l.id = se.league_id
        WHERE l.venue_id = s.id AND f.scheduled_date = current_date
          AND f.status IN ('scheduled','allocated','in_progress')),
      'open_incidents', (
        SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL),
      'critical_incidents', (
        SELECT count(*) FROM incidents i
        WHERE i.venue_id = s.id AND i.resolved_at IS NULL AND i.severity = 'critical'),
      'unallocated_this_week', (
        SELECT count(*) FROM fixtures f
        JOIN competitions cp ON cp.id = f.competition_id
        JOIN seasons se ON se.id = cp.season_id
        JOIN leagues l ON l.id = se.league_id
        WHERE l.venue_id = s.id AND f.scheduled_date BETWEEN current_date AND current_date + 7
          AND f.status IN ('scheduled','allocated') AND f.playing_area_id IS NULL),
      'unassigned_refs_this_week', (
        SELECT count(*) FROM fixtures f
        JOIN competitions cp ON cp.id = f.competition_id
        JOIN seasons se ON se.id = cp.season_id
        JOIN leagues l ON l.id = se.league_id
        WHERE l.venue_id = s.id AND f.scheduled_date BETWEEN current_date AND current_date + 7
          AND f.status IN ('scheduled','allocated') AND f.official_id IS NULL),
      'health', CASE
        WHEN EXISTS (SELECT 1 FROM incidents i
                     WHERE i.venue_id = s.id AND i.resolved_at IS NULL AND i.severity = 'critical')
          OR s.subscription_status IN ('past_due','cancelled')
          OR (s.trial_ends_at IS NOT NULL AND s.trial_ends_at < now())
          THEN 'red'
        WHEN (SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL) > 0
          OR EXISTS (SELECT 1 FROM fixtures f
                     JOIN competitions cp ON cp.id = f.competition_id
                     JOIN seasons se ON se.id = cp.season_id
                     JOIN leagues l ON l.id = se.league_id
                     WHERE l.venue_id = s.id
                       AND f.scheduled_date BETWEEN current_date AND current_date + 7
                       AND f.status IN ('scheduled','allocated')
                       AND (f.playing_area_id IS NULL OR f.official_id IS NULL))
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
    'company', v_company,
    'venues',  v_venues,
    'summary', v_summary,
    'caller',  jsonb_build_object('actor_type', v_actor, 'role', v_role, 'region', v_region)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.hq_get_company_state(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hq_get_company_state(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hq_get_company_state(text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 4. hq_get_venue_detail — single-venue drill-down (company + region scoped).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_get_venue_detail(p_company_id text, p_venue_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_venue venues%ROWTYPE;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT * INTO v_venue FROM venues WHERE id = p_venue_id AND company_id = p_company_id;
  IF v_venue.id IS NULL THEN RAISE EXCEPTION 'venue_not_in_company'; END IF;
  IF v_role = 'regional_admin' AND v_venue.region IS DISTINCT FROM v_region THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN jsonb_build_object(
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'region', v_venue.region,
      'city', v_venue.city, 'subscription_status', v_venue.subscription_status,
      'trial_ends_at', v_venue.trial_ends_at),
    'leagues', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'active', l.active)
                                ORDER BY l.name), '[]'::jsonb)
      FROM leagues l WHERE l.venue_id = p_venue_id),
    'open_incidents', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', i.id, 'description', i.description, 'severity', i.severity,
                'created_at', i.created_at, 'fixture_id', i.fixture_id)
              ORDER BY i.created_at DESC), '[]'::jsonb)
      FROM incidents i WHERE i.venue_id = p_venue_id AND i.resolved_at IS NULL),
    'fixtures_tonight', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', f.id, 'date', f.scheduled_date, 'time', f.kickoff_time, 'status', f.status,
                'home', ht.name, 'away', at.name, 'home_score', f.home_score, 'away_score', f.away_score)
              ORDER BY f.kickoff_time), '[]'::jsonb)
      FROM fixtures f
      JOIN competitions cp ON cp.id = f.competition_id
      JOIN seasons se ON se.id = cp.season_id
      JOIN leagues l ON l.id = se.league_id
      LEFT JOIN teams ht ON ht.id = f.home_team_id
      LEFT JOIN teams at ON at.id = f.away_team_id
      WHERE l.venue_id = p_venue_id AND f.scheduled_date = current_date),
    'fixtures_this_week', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', f.id, 'date', f.scheduled_date, 'time', f.kickoff_time, 'status', f.status,
                'home', ht.name, 'away', at.name,
                'pitch_allocated', f.playing_area_id IS NOT NULL, 'ref_assigned', f.official_id IS NOT NULL)
              ORDER BY f.scheduled_date, f.kickoff_time), '[]'::jsonb)
      FROM fixtures f
      JOIN competitions cp ON cp.id = f.competition_id
      JOIN seasons se ON se.id = cp.season_id
      JOIN leagues l ON l.id = se.league_id
      LEFT JOIN teams ht ON ht.id = f.home_team_id
      LEFT JOIN teams at ON at.id = f.away_team_id
      WHERE l.venue_id = p_venue_id
        AND f.scheduled_date BETWEEN current_date AND current_date + 7
        AND f.status IN ('scheduled','allocated','in_progress')),
    'fixtures_recent', (
      SELECT COALESCE(jsonb_agg(j ORDER BY j->>'date' DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'id', f.id, 'date', f.scheduled_date, 'status', f.status,
                 'home', ht.name, 'away', at.name, 'home_score', f.home_score, 'away_score', f.away_score) AS j
        FROM fixtures f
        JOIN competitions cp ON cp.id = f.competition_id
        JOIN seasons se ON se.id = cp.season_id
        JOIN leagues l ON l.id = se.league_id
        LEFT JOIN teams ht ON ht.id = f.home_team_id
        LEFT JOIN teams at ON at.id = f.away_team_id
        WHERE l.venue_id = p_venue_id AND f.status = 'completed'
        ORDER BY f.scheduled_date DESC LIMIT 10) r),
    'pending_registrations', (
      SELECT count(*) FROM competition_teams ct
      JOIN competitions cp ON cp.id = ct.competition_id
      JOIN seasons se ON se.id = cp.season_id
      JOIN leagues l ON l.id = se.league_id
      WHERE l.venue_id = p_venue_id AND ct.status = 'pending'),
    'refs', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', mo.id, 'name', mo.name, 'active', mo.active)
                                ORDER BY mo.name), '[]'::jsonb)
      FROM match_officials mo WHERE mo.venue_id = p_venue_id)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.hq_get_venue_detail(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hq_get_venue_detail(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hq_get_venue_detail(text, text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 5. hq_resolve_incident (WRITE) — close an incident, audit, notify the venue.
--    analyst is read-only → rejected.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_resolve_incident(
  p_company_id text, p_incident_id uuid, p_resolution_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_uid uuid := auth.uid();
  v_venue_id text; v_venue_region text; v_resolved timestamptz;
  v_note text := NULLIF(btrim(p_resolution_note), '');
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_role = 'analyst' THEN RAISE EXCEPTION 'read_only_role'; END IF;

  SELECT v.id, v.region INTO v_venue_id, v_venue_region
  FROM incidents i JOIN venues v ON v.id = i.venue_id
  WHERE i.id = p_incident_id AND v.company_id = p_company_id AND i.resolved_at IS NULL;
  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'incident_not_found_or_resolved'; END IF;
  IF v_role = 'regional_admin' AND v_venue_region IS DISTINCT FROM v_region THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE incidents
     SET resolved_at = now(), resolved_by = v_uid, resolution_note = v_note
   WHERE id = p_incident_id
   RETURNING resolved_at INTO v_resolved;

  -- audit_events.team_id is NOT NULL with no FK — venue-scoped events store the venue_id
  -- here (matches the venue_admin convention), since an incident has no team.
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, v_uid, v_actor, 'user_id:' || COALESCE(v_uid::text, '?'),
          'incident_resolved', 'incident', p_incident_id::text,
          jsonb_build_object('company_id', p_company_id, 'venue_id', v_venue_id, 'note', v_note));

  PERFORM public.notify_venue_change(v_venue_id, 'incident_resolved');

  RETURN jsonb_build_object('ok', true, 'incident_id', p_incident_id, 'resolved_at', v_resolved);
END;
$fn$;
REVOKE ALL ON FUNCTION public.hq_resolve_incident(text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hq_resolve_incident(text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hq_resolve_incident(text, uuid, text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 6. notify_venue_change — add 'incident_resolved' to the whitelist.
--    Full mig-127 list preserved verbatim (mig-121 regression caution); one reason added.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    'venue_created','venue_updated','season_created','season_updated',
    'fixtures_generated','fixtures_cascaded','fixture_scheduled','fixture_status_changed',
    'fixture_postponed','fixture_voided','fixture_walkover','fixture_forfeit',
    'ref_assigned','ref_changed','ref_no_show','ref_added','ref_updated',
    'pitch_assigned','pitch_added','pitch_updated','pitch_closed',
    'team_registration_pending','team_approved','team_rejected','team_withdrew','team_expelled',
    'incident_flagged',
    'match_started','match_event_recorded','match_result_saved',
    'result_corrected',
    -- Phase 6 HQ (mig 171)
    'incident_resolved'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_venue_change: unknown reason "%" for venue "%"', p_reason, p_venue_id;
  END IF;

  SELECT live_channel_key INTO v_channel_key FROM venues WHERE id = p_venue_id;
  IF v_channel_key IS NULL THEN RETURN; END IF;

  PERFORM realtime.send(
    jsonb_build_object('type','venue_state_changed','reason',p_reason,'at',extract(epoch from now())),
    'broadcast', 'venue_live:' || v_channel_key, false);
END;
$function$;
REVOKE ALL     ON FUNCTION public.notify_venue_change(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_venue_change(text, text) FROM anon, authenticated;
