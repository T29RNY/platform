-- 089_phase2_cycle22_rpc_patches.sql
--
-- Cycle 2.2 in-flight patches caught while probing the just-shipped
-- read RPCs against a freshly seeded test venue.
--
-- Patches:
--   1. venue_get_state.open_incidents — original referenced
--      incidents.status (doesn't exist) and joined through fixtures.
--      Fixed to use incidents.venue_id directly + resolved_at IS NULL
--      as the "open" derivation. Restored fields match the live
--      schema (no status, but reported_by + resolution_note exist).
--
--   2. join_get_league_by_code.competitions_open — filtered on
--      status='registration_open' which is not in the seasons/
--      competitions CHECK constraints. Tightened to ('setup','active')
--      which is the actual flow ('setup' = pre-launch accepting
--      registrations; 'active' = mid-season can still accept late
--      entries).
--
-- 086 source file updated in repo to match; this migration brings the
-- live DB in line.

CREATE OR REPLACE FUNCTION public.venue_get_state(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    SELECT id, venue_id, name, short_name, sport, format,
           day_of_week, default_kickoff_time, default_playing_area_id,
           league_admin_token, league_code, display_token,
           squad_mode, squad_mode_locked_at, standings_visibility,
           active, created_at
    FROM leagues WHERE venue_id = v_venue_id
  ),
  v_seasons AS (
    SELECT s.id, s.league_id, s.name, s.start_date, s.end_date,
           s.num_weeks, s.status, s.created_at
    FROM seasons s WHERE s.league_id IN (SELECT id FROM v_leagues)
  ),
  v_competitions AS (
    SELECT c.id, c.season_id, c.name, c.type, c.format,
           c.status, c.created_at
    FROM competitions c WHERE c.season_id IN (SELECT id FROM v_seasons)
  ),
  v_fixtures_all AS (
    SELECT f.id, f.competition_id, f.home_team_id, f.away_team_id,
           f.week_number, f.round_name, f.scheduled_date, f.kickoff_time,
           f.playing_area_id, f.official_id, f.status,
           f.home_score, f.away_score,
           f.walkover_winner_id, f.postpone_reason, f.void_reason
    FROM fixtures f WHERE f.competition_id IN (SELECT id FROM v_competitions)
  ),
  v_pending AS (
    SELECT ct.id, ct.competition_id, ct.team_id, ct.status,
           ct.registered_at, t.name AS team_name
    FROM competition_teams ct
    LEFT JOIN teams t ON t.id = ct.team_id
    WHERE ct.competition_id IN (SELECT id FROM v_competitions)
      AND ct.status = 'pending'
  )
  SELECT jsonb_build_object(
    'venue', (
      SELECT jsonb_build_object(
        'id', v.id, 'name', v.name, 'slug', v.slug, 'sport', v.sport,
        'address', v.address, 'city', v.city, 'postcode', v.postcode,
        'logo_url', v.logo_url, 'primary_colour', v.primary_colour,
        'secondary_colour', v.secondary_colour, 'contact_email', v.contact_email,
        'contact_phone', v.contact_phone, 'venue_admin_token', v.venue_admin_token,
        'live_channel_key', v.live_channel_key, 'display_pin', v.display_pin,
        'active', v.active, 'subscription_status', v.subscription_status,
        'trial_ends_at', v.trial_ends_at, 'created_at', v.created_at
      )
      FROM venues v WHERE v.id = v_venue_id
    ),
    'leagues', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM v_leagues l), '[]'::jsonb),
    'seasons', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM v_seasons s), '[]'::jsonb),
    'competitions', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM v_competitions c), '[]'::jsonb),
    'fixtures', jsonb_build_object(
      'tonight', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.kickoff_time NULLS LAST) FROM v_fixtures_all f WHERE f.scheduled_date = v_today), '[]'::jsonb),
      'this_week', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.scheduled_date, f.kickoff_time NULLS LAST) FROM v_fixtures_all f WHERE f.scheduled_date BETWEEN v_today AND v_week_end), '[]'::jsonb),
      'upcoming', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.scheduled_date, f.kickoff_time NULLS LAST) FROM (SELECT * FROM v_fixtures_all WHERE scheduled_date > v_week_end AND status IN ('scheduled','postponed') ORDER BY scheduled_date, kickoff_time NULLS LAST LIMIT 50) f), '[]'::jsonb),
      'recent', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.scheduled_date DESC, f.kickoff_time DESC NULLS LAST) FROM (SELECT * FROM v_fixtures_all WHERE scheduled_date < v_today AND status IN ('completed','walkover','forfeit','voided') ORDER BY scheduled_date DESC, kickoff_time DESC NULLS LAST LIMIT 20) f), '[]'::jsonb)
    ),
    'refs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', mo.id, 'name', mo.name, 'phone', mo.phone, 'email', mo.email,
        'whatsapp_number', mo.whatsapp_number, 'preferred_channel', mo.preferred_channel,
        'employment_type', mo.employment_type, 'overall_rating', mo.overall_rating,
        'active', mo.active
      ) ORDER BY mo.name)
      FROM match_officials mo WHERE mo.venue_id = v_venue_id
    ), '[]'::jsonb),
    'pitches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pa.id, 'name', pa.name, 'surface', pa.surface, 'capacity', pa.capacity,
        'active', pa.active, 'is_available', pa.is_available,
        'maintenance_windows', pa.maintenance_windows, 'sort_order', pa.sort_order
      ) ORDER BY pa.sort_order, pa.name)
      FROM playing_areas pa WHERE pa.venue_id = v_venue_id
    ), '[]'::jsonb),
    'pending_registrations', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.registered_at DESC) FROM v_pending p), '[]'::jsonb),
    'open_incidents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'fixture_id', i.fixture_id, 'description', i.description,
        'severity', i.severity, 'reported_by', i.reported_by,
        'created_at', i.created_at
      ) ORDER BY i.created_at DESC)
      FROM incidents i
      WHERE i.venue_id = v_venue_id
        AND i.resolved_at IS NULL
    ), '[]'::jsonb),
    'caller', jsonb_build_object('actor_type', v_caller.actor_type, 'actor_ident', v_caller.actor_ident)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.join_get_league_by_code(p_league_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_league record;
  v_venue record;
  v_result jsonb;
BEGIN
  IF p_league_code IS NULL OR length(trim(p_league_code)) = 0 THEN
    RAISE EXCEPTION 'league_code_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, venue_id, name, short_name, sport, format,
         day_of_week, default_kickoff_time, league_code,
         squad_mode, active
  INTO v_league
  FROM leagues
  WHERE league_code = upper(trim(p_league_code))
    AND active = true
  LIMIT 1;

  IF v_league.id IS NULL THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, name, slug, sport, city, postcode, logo_url,
         primary_colour, secondary_colour
  INTO v_venue
  FROM venues WHERE id = v_league.venue_id;

  IF v_venue.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM venues WHERE id = v_league.venue_id AND active = true
  ) THEN
    RAISE EXCEPTION 'venue_inactive' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
    'league', jsonb_build_object(
      'id', v_league.id, 'name', v_league.name, 'short_name', v_league.short_name,
      'sport', v_league.sport, 'format', v_league.format,
      'day_of_week', v_league.day_of_week, 'default_kickoff_time', v_league.default_kickoff_time,
      'league_code', v_league.league_code, 'squad_mode', v_league.squad_mode
    ),
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'slug', v_venue.slug, 'sport', v_venue.sport,
      'city', v_venue.city, 'postcode', v_venue.postcode, 'logo_url', v_venue.logo_url,
      'primary_colour', v_venue.primary_colour, 'secondary_colour', v_venue.secondary_colour
    ),
    'competitions_open', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'type', c.type, 'format', c.format,
        'season_id', c.season_id, 'season_name', s.name,
        'season_start', s.start_date, 'season_end', s.end_date
      ) ORDER BY s.start_date)
      FROM competitions c
      JOIN seasons s ON s.id = c.season_id
      WHERE s.league_id = v_league.id
        AND c.status IN ('setup','active')
        AND s.status IN ('setup','active')
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
