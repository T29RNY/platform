-- 464_incident_triage_read_shape.sql
-- Incident Triage — PR #3: read-shape additions + HQ escalation inbox RPC.
-- Depends on migs 461 (columns) + 462 (write RPCs).
--
-- Consumers (Hard Rule #14): venue_get_state / hq_get_venue_detail open_incidents[]
-- gain the triage fields (Venue Ops live, HQ live); hq_list_escalated_incidents is
-- read by the HQ escalation inbox (live, PR#6). Future: Gaffer AI incident-risk
-- context, HQ analytics, reception display.
--
-- venue_get_state + hq_get_venue_detail bodies are reproduced VERBATIM from live
-- (2026-07-01) with ONLY the open_incidents jsonb_build_object extended — no other
-- logic changed. assigned_to_name reuses the existing public._venue_actor_name(uuid)
-- helper (same source as reported_by_name).

-- ---------------------------------------------------------------------------
-- 1. venue_get_state — extend open_incidents with triage fields.
-- ---------------------------------------------------------------------------
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
      FROM incidents i WHERE i.venue_id = v_venue_id AND i.resolved_at IS NULL), '[]'::jsonb),
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

-- ---------------------------------------------------------------------------
-- 2. hq_get_venue_detail — extend open_incidents with triage fields.
-- ---------------------------------------------------------------------------
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
      FROM incidents i WHERE i.venue_id = p_venue_id AND i.resolved_at IS NULL),
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

-- ---------------------------------------------------------------------------
-- 3. hq_list_escalated_incidents — cross-venue escalation inbox (read).
--    Region-scoped for regional_admin; analyst ALLOWED (read-only, no write block).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hq_list_escalated_incidents(
  p_company_id text,
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
) RETURNS jsonb
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
  -- analyst is ALLOWED here (read-only surface) — no read_only_role block.

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
      AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
      AND (p_date_from IS NULL OR i.escalated_at >= p_date_from)
      AND (p_date_to   IS NULL OR i.escalated_at < (p_date_to + 1))
  ), '[]'::jsonb);
END;
$function$;

-- HQ is authenticated-only. REVOKE anon explicitly too: default privileges auto-grant
-- anon+authenticated as NAMED roles, so REVOKE FROM PUBLIC alone leaves anon with EXECUTE.
REVOKE ALL ON FUNCTION public.hq_list_escalated_incidents(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_list_escalated_incidents(text, date, date) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
