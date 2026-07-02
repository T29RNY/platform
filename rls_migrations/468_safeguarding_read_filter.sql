-- Migration 468: Safeguarding module — read-filter sweep + Lead-only list RPC.
-- (Incident Triage Phase 2, PR #3. Depends on migs 466 schema + 467 write RPCs.)
--
-- THE LOAD-BEARING SECURITY PR. A flagged incident must be INVISIBLE to every
-- ordinary operational and HQ surface — queues, escalation inbox, AND every
-- count / health tile — and visible ONLY to a designated Safeguarding Lead
-- through the dedicated Lead list below.
--
-- Design contract (SAFEGUARDING_MODULE_HANDOFF.md):
--   LD#2  visibility keys on the boolean flag `is_safeguarding_flagged`, never
--         on the `category` enum (a rename/typo must never silently un-restrict).
--   LD#5/OQ(c)  the FOUR existing ops/HQ reads get a one-line
--         `AND i.is_safeguarding_flagged IS NOT TRUE` and NOTHING else — no lead
--         branch, no shape change → zero HR12 mapper churn. A new dedicated RPC
--         serves Leads. Flagged bodies never transit a non-lead client.
--   LD#7  every Lead READ of the safeguarding list writes an audit_events row
--         (who looked, which venue, when) — stronger than Hard Rule 9.
--
-- The FOUR read bodies below are reproduced VERBATIM from live (pg_get_functiondef,
-- 2026-07-02). The ONLY change in each is the added exclusion predicate — marked
-- with an inline `-- SG468` comment at each incident-read site so the enforcement
-- script (skills/scripts/check-incident-safeguarding.sh) and any future reviewer
-- can see every patched clause. `hq_get_company_state` has THREE incident reads
-- (per-venue open, per-venue critical, company-wide summary) — all three patched;
-- the red/amber health CASE derives from the two per-venue counts, so patching
-- those covers the health-tile existence-oracle too.

-- ===========================================================================
-- 1. venue_get_state — venue-desktop ops queue. Patch: open_incidents.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_get_state(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_today date := current_date;
  v_week_end date := current_date + 6;
  v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  WITH
  v_leagues AS (
    SELECT id, venue_id, name, short_name, sport, format, day_of_week, default_kickoff_time,
           default_playing_area_id, league_admin_token, league_code, display_token,
           squad_mode, squad_mode_locked_at, standings_visibility, active, created_at
    FROM leagues WHERE venue_id = v_venue_id),
  v_seasons AS (
    SELECT s.id, s.league_id, s.name, s.start_date, s.end_date, s.num_weeks, s.status, s.created_at
    FROM seasons s WHERE s.league_id IN (SELECT id FROM v_leagues)),
  v_competitions AS (
    SELECT c.id, c.season_id, c.name, c.type, c.format, c.status, c.created_at
    FROM competitions c WHERE c.season_id IN (SELECT id FROM v_seasons)),
  v_fixtures_all AS (
    SELECT f.id, f.competition_id, f.home_team_id, f.away_team_id, f.week_number, f.round_name,
           f.scheduled_date, f.kickoff_time, f.playing_area_id, f.official_id, f.status,
           f.home_score, f.away_score, f.walkover_winner_id, f.forfeit_winner_id,
           f.postpone_reason, f.void_reason, f.forfeit_reason
    FROM fixtures f WHERE f.competition_id IN (SELECT id FROM v_competitions)),
  v_pending AS (
    SELECT ct.id, ct.competition_id, ct.team_id, ct.status, ct.registered_at,
           t.name AS team_name, t.admin_email AS captain_email,
           c.name AS competition_name
    FROM competition_teams ct
    LEFT JOIN teams t ON t.id = ct.team_id
    LEFT JOIN competitions c ON c.id = ct.competition_id
    WHERE ct.competition_id IN (SELECT id FROM v_competitions) AND ct.status = 'pending'),
  v_teams_dir AS (
    SELECT DISTINCT t.id, t.name, t.primary_colour, t.secondary_colour
    FROM teams t
    JOIN competition_teams ct ON ct.team_id = t.id
    WHERE ct.competition_id IN (SELECT id FROM v_competitions)),
  v_charges AS (
    SELECT c.amount_due_pence, c.status,
           COALESCE((SELECT SUM(CASE WHEN p.kind='payment' THEN p.amount_pence ELSE -p.amount_pence END)
                     FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid_pence
    FROM venue_charges c WHERE c.venue_id = v_venue_id)
  SELECT jsonb_build_object(
    'venue', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug, 'sport', v.sport,
        'address', v.address, 'city', v.city, 'postcode', v.postcode, 'logo_url', v.logo_url,
        'primary_colour', v.primary_colour, 'secondary_colour', v.secondary_colour,
        'contact_email', v.contact_email, 'contact_phone', v.contact_phone,
        'venue_admin_token', v.venue_admin_token, 'live_channel_key', v.live_channel_key,
        'display_pin', v.display_pin, 'display_token', v.display_token, 'display_config', v.display_config,
        'active', v.active, 'subscription_status', v.subscription_status,
        'trial_ends_at', v.trial_ends_at, 'created_at', v.created_at,
        'bookings_enabled', v.bookings_enabled, 'cancellation_policy', v.cancellation_policy,
        'payment_link', v.payment_link,
        'default_prime_time_windows', v.default_prime_time_windows) FROM venues v WHERE v.id = v_venue_id),
    'leagues', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM v_leagues l), '[]'::jsonb),
    'seasons', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM v_seasons s), '[]'::jsonb),
    'competitions', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM v_competitions c), '[]'::jsonb),
    'teams', COALESCE((SELECT jsonb_object_agg(td.id, jsonb_build_object(
        'id', td.id, 'name', td.name,
        'primary_colour', td.primary_colour, 'secondary_colour', td.secondary_colour))
      FROM v_teams_dir td), '{}'::jsonb),
    'fixtures', jsonb_build_object(
      'tonight', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.kickoff_time NULLS LAST) FROM v_fixtures_all f WHERE f.scheduled_date = v_today), '[]'::jsonb),
      'this_week', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.scheduled_date, f.kickoff_time NULLS LAST) FROM v_fixtures_all f WHERE f.scheduled_date BETWEEN v_today AND v_week_end), '[]'::jsonb),
      'upcoming', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.scheduled_date, f.kickoff_time NULLS LAST) FROM (SELECT * FROM v_fixtures_all WHERE scheduled_date > v_week_end AND status IN ('scheduled','allocated','postponed') ORDER BY scheduled_date, kickoff_time NULLS LAST LIMIT 50) f), '[]'::jsonb),
      'recent', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.scheduled_date DESC, f.kickoff_time DESC NULLS LAST) FROM (SELECT * FROM v_fixtures_all WHERE scheduled_date < v_today AND status IN ('completed','walkover','forfeit','voided') ORDER BY scheduled_date DESC, kickoff_time DESC NULLS LAST LIMIT 20) f), '[]'::jsonb)
    ),
    'refs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', mo.id, 'name', mo.name, 'phone', mo.phone, 'email', mo.email,
        'whatsapp_number', mo.whatsapp_number, 'preferred_channel', mo.preferred_channel,
        'employment_type', mo.employment_type, 'overall_rating', mo.overall_rating, 'active', mo.active) ORDER BY mo.name)
      FROM match_officials mo WHERE mo.venue_id = v_venue_id), '[]'::jsonb),
    'pitches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name, 'surface', pa.surface,
        'capacity', pa.capacity, 'active', pa.active, 'is_available', pa.is_available,
        'maintenance_windows', pa.maintenance_windows, 'booking_windows', pa.booking_windows,
        'prime_time_windows', pa.prime_time_windows,
        'sort_order', pa.sort_order) ORDER BY pa.sort_order, pa.name)
      FROM playing_areas pa WHERE pa.venue_id = v_venue_id), '[]'::jsonb),
    'pending_registrations', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.registered_at DESC) FROM v_pending p), '[]'::jsonb),
    'open_incidents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'fixture_id', i.fixture_id, 'description', i.description,
        'severity', i.severity, 'reported_by', i.reported_by, 'reported_by_name', public._venue_actor_name(i.reported_by),
        'category', i.category, 'priority', i.priority, 'assigned_to', i.assigned_to,
        'assigned_to_name', public._venue_actor_name(i.assigned_to),
        'acknowledged_at', i.acknowledged_at, 'escalated_at', i.escalated_at, 'escalation_reason', i.escalation_reason,
        'created_at', i.created_at) ORDER BY i.created_at DESC)
      FROM incidents i WHERE i.venue_id = v_venue_id AND i.resolved_at IS NULL AND i.is_safeguarding_flagged IS NOT TRUE /* SG468 */), '[]'::jsonb),
    'payments_summary', (SELECT jsonb_build_object(
      'owed_pence',        COALESCE(SUM(amount_due_pence) FILTER (WHERE status <> 'refunded'), 0),
      'collected_pence',   COALESCE(SUM(paid_pence)       FILTER (WHERE status <> 'refunded'), 0),
      'outstanding_pence', COALESCE(SUM(GREATEST(amount_due_pence - paid_pence, 0)) FILTER (WHERE status <> 'refunded'), 0)
    ) FROM v_charges),
    'caller', jsonb_build_object('actor_type', v_caller.actor_type, 'actor_ident', v_caller.actor_ident)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- ===========================================================================
-- 2. hq_get_venue_detail — HQ per-venue drill-down. Patch: open_incidents.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.hq_get_venue_detail(p_company_id text, p_venue_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'region', v_venue.region,
      'city', v_venue.city, 'subscription_status', v_venue.subscription_status, 'trial_ends_at', v_venue.trial_ends_at),
    'leagues', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'active', l.active) ORDER BY l.name), '[]'::jsonb)
      FROM leagues l WHERE l.venue_id = p_venue_id),
    'open_incidents', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', i.id, 'description', i.description, 'severity', i.severity, 'created_at', i.created_at, 'fixture_id', i.fixture_id,
                'category', i.category, 'priority', i.priority, 'assigned_to', i.assigned_to,
                'assigned_to_name', public._venue_actor_name(i.assigned_to),
                'acknowledged_at', i.acknowledged_at, 'escalated_at', i.escalated_at, 'escalation_reason', i.escalation_reason)
              ORDER BY i.created_at DESC), '[]'::jsonb)
      FROM incidents i WHERE i.venue_id = p_venue_id AND i.resolved_at IS NULL AND i.is_safeguarding_flagged IS NOT TRUE /* SG468 */),
    'fixtures_tonight', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', f.id, 'date', f.scheduled_date, 'time', f.kickoff_time, 'status', f.status,
                'home', ht.name, 'away', at.name, 'home_score', f.home_score, 'away_score', f.away_score)
              ORDER BY f.kickoff_time), '[]'::jsonb)
      FROM fixtures f JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
      LEFT JOIN teams ht ON ht.id = f.home_team_id LEFT JOIN teams at ON at.id = f.away_team_id
      WHERE l.venue_id = p_venue_id AND f.scheduled_date = current_date),
    'fixtures_this_week', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', f.id, 'date', f.scheduled_date, 'time', f.kickoff_time, 'status', f.status,
                'home', ht.name, 'away', at.name, 'pitch_allocated', f.playing_area_id IS NOT NULL, 'ref_assigned', f.official_id IS NOT NULL)
              ORDER BY f.scheduled_date, f.kickoff_time), '[]'::jsonb)
      FROM fixtures f JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
      LEFT JOIN teams ht ON ht.id = f.home_team_id LEFT JOIN teams at ON at.id = f.away_team_id
      WHERE l.venue_id = p_venue_id AND f.scheduled_date BETWEEN current_date AND current_date + 7 AND f.status IN ('scheduled','allocated','in_progress')),
    'fixtures_recent', (SELECT COALESCE(jsonb_agg(j ORDER BY j->>'date' DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('id', f.id, 'date', f.scheduled_date, 'status', f.status,
                 'home', ht.name, 'away', at.name, 'home_score', f.home_score, 'away_score', f.away_score) AS j
        FROM fixtures f JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
        LEFT JOIN teams ht ON ht.id = f.home_team_id LEFT JOIN teams at ON at.id = f.away_team_id
        WHERE l.venue_id = p_venue_id AND f.status = 'completed' ORDER BY f.scheduled_date DESC LIMIT 10) r),
    'pending_registrations', (SELECT count(*) FROM competition_teams ct
      JOIN competitions cp ON cp.id = ct.competition_id JOIN seasons se ON se.id = cp.season_id JOIN leagues l ON l.id = se.league_id
      WHERE l.venue_id = p_venue_id AND ct.status = 'pending'),
    'refs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', mo.id, 'name', mo.name, 'active', mo.active) ORDER BY mo.name), '[]'::jsonb)
      FROM match_officials mo WHERE mo.venue_id = p_venue_id)
  );
END;
$function$;

-- ===========================================================================
-- 3. hq_list_escalated_incidents — HQ cross-venue escalation inbox
--    (analyst-read-allowed). Patch: the single incident read.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.hq_list_escalated_incidents(p_company_id text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'venue_id', i.venue_id, 'venue_name', v.name, 'region', v.region,
        'description', i.description, 'severity', i.severity,
        'category', i.category, 'priority', i.priority,
        'assigned_to', i.assigned_to, 'assigned_to_name', public._venue_actor_name(i.assigned_to),
        'escalated_at', i.escalated_at, 'escalated_by', i.escalated_by,
        'escalation_reason', i.escalation_reason, 'created_at', i.created_at)
      ORDER BY i.escalated_at DESC)
    FROM incidents i
    JOIN venues v ON v.id = i.venue_id
    WHERE v.company_id = p_company_id
      AND i.escalated_at IS NOT NULL
      AND i.resolved_at IS NULL
      AND i.is_safeguarding_flagged IS NOT TRUE /* SG468 */
      AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
      AND (p_date_from IS NULL OR i.escalated_at >= p_date_from)
      AND (p_date_to   IS NULL OR i.escalated_at < (p_date_to + 1))
  ), '[]'::jsonb);
END;
$function$;

-- ===========================================================================
-- 4. hq_get_company_state — HQ company overview. THREE incident reads:
--    (a) per-venue open count, (b) per-venue critical count, (c) company-wide
--    summary open count. All three patched. The red/amber health CASE derives
--    from (a)+(b) — patching those closes the health-tile existence-oracle too.
-- ===========================================================================
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
        (SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL AND i.is_safeguarding_flagged IS NOT TRUE /* SG468 */) AS open_inc,
        (SELECT count(*) FROM incidents i WHERE i.venue_id = s.id AND i.resolved_at IS NULL AND i.is_safeguarding_flagged IS NOT TRUE /* SG468 */ AND i.severity = 'critical') AS crit_inc,
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
    'open_incidents',   (SELECT count(*) FROM incidents i WHERE i.venue_id IN (SELECT id FROM scoped) AND i.resolved_at IS NULL AND i.is_safeguarding_flagged IS NOT TRUE /* SG468 */),
    'fixtures_completed',(SELECT count(*) FROM fixtures f WHERE f.competition_id IN (SELECT id FROM cp) AND f.status = 'completed'),
    'fixtures_remaining',(SELECT count(*) FROM fixtures f WHERE f.competition_id IN (SELECT id FROM cp) AND f.status IN ('scheduled','allocated','in_progress','postponed'))
  ) INTO v_summary;

  RETURN jsonb_build_object(
    'company', v_company, 'venues', v_venues, 'summary', v_summary,
    'caller', jsonb_build_object('actor_type', v_actor, 'role', v_role, 'region', v_region));
END;
$function$;

-- ===========================================================================
-- 5. venue_list_safeguarding_incidents — the Lead-ONLY read (LD#5).
--    Non-leads get the SAME 'not_a_safeguarding_lead' error as venue_unflag —
--    the flagged bodies never transit a non-lead client. Writes a read-audit
--    row (LD#7 — child-protection records need "who accessed this"), so this is
--    a VOLATILE function (it has a side effect), NOT marked STABLE. Reads
--    flagged OPEN rows only. Returns structural incident fields; v1 has no
--    free-text disclosure beyond the operator-entered `description` that already
--    exists on every incident (the SAME field ops sees pre-flag) — NO new
--    special-category narrative field is introduced here.
--    This is the ONE function permitted to read flagged rows; it is on the
--    check-incident-safeguarding.sh allow-list.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_list_safeguarding_incidents(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  record;
  v_venue_id text;
  v_rows    jsonb;
  v_count   int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_is_safeguarding_lead(v_caller.actor_ident, v_venue_id) THEN
    RAISE EXCEPTION 'not_a_safeguarding_lead' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', i.id, 'fixture_id', i.fixture_id, 'description', i.description,
            'severity', i.severity, 'category', i.category, 'priority', i.priority,
            'reported_by', i.reported_by, 'reported_by_name', public._venue_actor_name(i.reported_by),
            'created_at', i.created_at,
            -- safeguarding_flagged_by is an actor_ident TEXT tag ('user_id:<uuid>' or
            -- 'venue_admin_token:<md5>'), NOT a uuid — so it is NOT passed through
            -- _venue_actor_name(uuid). Returned raw; PR#4 renders it. (v1-minimal.)
            'safeguarding_flagged_by', i.safeguarding_flagged_by,
            'safeguarding_flagged_at', i.safeguarding_flagged_at)
          ORDER BY i.safeguarding_flagged_at DESC), '[]'::jsonb),
         count(*)
    INTO v_rows, v_count
    FROM incidents i
   WHERE i.venue_id = v_venue_id
     AND i.resolved_at IS NULL
     AND i.is_safeguarding_flagged IS TRUE;  -- Lead view: the ONLY read of flagged rows

  -- LD#7 read-audit: who looked, which venue, when. Structural facts only —
  -- NEVER a concern's detail in metadata (audit_events has broad read paths).
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'safeguarding_incident_viewed', 'venue', v_venue_id,
          jsonb_build_object('venue_id', v_venue_id, 'flagged_count', v_count));

  RETURN jsonb_build_object('ok', true, 'incidents', v_rows, 'count', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_safeguarding_incidents(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_safeguarding_incidents(text) TO anon, authenticated;

-- Schema-cache reload so PostgREST serves the new signature immediately.
SELECT pg_notify('pgrst', 'reload schema');
