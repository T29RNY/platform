-- Migration 183 — Venue Payments Ledger V3.1
--
-- Operator controls for the ledger beyond the V2 auto-creation hooks:
--   1. venue_add_fixture_charge  — manually add a per-team fixture charge (the
--      operational "this team also pays" toggle; amount = arg or league default).
--   2. venue_void_charge         — void a charge (status -> refunded, payments kept;
--      mirrors the venue_update_fixture_status void hook). Drops out of owed/collected.
--   3. venue_update_booking_settings gains a `payment_link` key (validated http(s)).
--   4. venue_get_state exposes `payment_link` on the venue object (was missing; the
--      apps/venue PaymentsView already reads venue.payment_link but it was always null).
--
-- Both new write RPCs: SECDEF, search_path pinned, resolve_venue_caller, audited,
-- notify_venue_change('charge_updated') (already whitelisted in V2). Charge add is
-- idempotent against the venue_charges_source_uniq index: a refunded charge for the
-- same (fixture, team) is reactivated rather than duplicated.
--
-- venue_update_booking_settings + venue_get_state rebuilt on their LIVE bodies
-- (pulled via pg_get_functiondef this cycle) — additive only, all prior keys kept.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. venue_add_fixture_charge — manual per-team fixture charge
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_add_fixture_charge(
  p_venue_token text, p_fixture_id uuid, p_team_id text, p_amount_pence integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_fx record; v_existing record;
  v_amount int; v_charge_id uuid; v_reactivated boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT f.id, f.home_team_id, f.away_team_id, f.scheduled_date, f.competition_id,
         s.league_id AS league_id, l.venue_id AS venue_id
  INTO v_fx
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE f.id = p_fixture_id;

  IF v_fx.id IS NULL THEN RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_fx.venue_id <> v_venue_id THEN RAISE EXCEPTION 'fixture_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NULL
     OR (p_team_id IS DISTINCT FROM v_fx.home_team_id AND p_team_id IS DISTINCT FROM v_fx.away_team_id) THEN
    RAISE EXCEPTION 'team_not_in_fixture' USING ERRCODE = 'P0001', DETAIL = COALESCE(p_team_id, '(null)');
  END IF;

  IF p_amount_pence IS NOT NULL THEN
    IF p_amount_pence <= 0 THEN RAISE EXCEPTION 'amount_invalid' USING ERRCODE = 'P0001'; END IF;
    v_amount := p_amount_pence;
  ELSE
    SELECT fixture_fee_pence INTO v_amount FROM league_config WHERE league_id = v_fx.league_id;
    IF COALESCE(v_amount, 0) <= 0 THEN RAISE EXCEPTION 'no_fee_configured' USING ERRCODE = 'P0001'; END IF;
  END IF;

  SELECT * INTO v_existing FROM venue_charges
  WHERE source_type = 'fixture' AND source_id = p_fixture_id::text
    AND COALESCE(team_id, '') = COALESCE(p_team_id, '');

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status <> 'refunded' THEN
      RAISE EXCEPTION 'charge_exists' USING ERRCODE = 'P0001', DETAIL = v_existing.id::text;
    END IF;
    -- reactivate a previously-voided charge: clear the terminal 'refunded' status
    -- (else _recompute_charge_status preserves it), reset amount, recompute from kept payments
    UPDATE venue_charges SET amount_due_pence = v_amount, due_date = v_fx.scheduled_date, status = 'unpaid'
    WHERE id = v_existing.id;
    PERFORM public._recompute_charge_status(v_existing.id);
    v_charge_id := v_existing.id;
    v_reactivated := true;
  ELSE
    INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id,
                               amount_due_pence, status, due_date)
    VALUES (v_venue_id, 'fixture', p_fixture_id::text, p_team_id, v_fx.competition_id,
            v_amount, 'unpaid', v_fx.scheduled_date)
    RETURNING id INTO v_charge_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (COALESCE(p_team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'charge_created', 'venue_charge', v_charge_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'fixture_id', p_fixture_id, 'team_id', p_team_id,
                             'amount_pence', v_amount, 'reactivated', v_reactivated));

  PERFORM public.notify_venue_change(v_venue_id, 'charge_updated');

  RETURN jsonb_build_object('ok', true, 'charge_id', v_charge_id, 'reactivated', v_reactivated,
    'amount_due_pence', v_amount,
    'status', (SELECT status FROM venue_charges WHERE id = v_charge_id));
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_add_fixture_charge(text, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_add_fixture_charge(text, uuid, text, integer) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. venue_void_charge — void a charge (status -> refunded, payments kept)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_void_charge(p_venue_token text, p_charge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_charge record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_charge FROM venue_charges WHERE id = p_charge_id;
  IF v_charge.id IS NULL THEN RAISE EXCEPTION 'charge_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_charge.venue_id <> v_venue_id THEN RAISE EXCEPTION 'charge_not_in_venue' USING ERRCODE = 'P0001'; END IF;

  IF v_charge.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'charge_id', p_charge_id, 'status', 'refunded', 'already', true);
  END IF;

  UPDATE venue_charges SET status = 'refunded' WHERE id = p_charge_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_charge.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'charge_voided', 'venue_charge', p_charge_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'source_type', v_charge.source_type,
                             'source_id', v_charge.source_id, 'team_id', v_charge.team_id,
                             'amount_due_pence', v_charge.amount_due_pence));

  PERFORM public.notify_venue_change(v_venue_id, 'charge_updated');

  RETURN jsonb_build_object('ok', true, 'charge_id', p_charge_id, 'status', 'refunded', 'already', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_void_charge(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_void_charge(text, uuid) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. venue_update_booking_settings — + payment_link key (rebuilt on live body)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_update_booking_settings(p_venue_token text, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_changed  text[] := ARRAY[]::text[];
  v_pw jsonb;
  v_w jsonb;
  v_link text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' OR p_updates = '{}'::jsonb THEN
    RAISE EXCEPTION 'updates_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_updates ? 'bookings_enabled' THEN
    IF jsonb_typeof(p_updates->'bookings_enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'bookings_enabled_invalid' USING ERRCODE = 'P0001';
    END IF;
    UPDATE venues SET bookings_enabled = (p_updates->>'bookings_enabled')::boolean WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'bookings_enabled');
  END IF;

  IF p_updates ? 'cancellation_policy' THEN
    UPDATE venues SET cancellation_policy = NULLIF(trim(p_updates->>'cancellation_policy'), '') WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'cancellation_policy');
  END IF;

  IF p_updates ? 'payment_link' THEN
    v_link := NULLIF(trim(p_updates->>'payment_link'), '');
    IF v_link IS NOT NULL AND v_link !~* '^https?://' THEN
      RAISE EXCEPTION 'payment_link_invalid' USING ERRCODE = 'P0001';
    END IF;
    UPDATE venues SET payment_link = v_link WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'payment_link');
  END IF;

  IF p_updates ? 'default_prime_time_windows' THEN
    v_pw := p_updates->'default_prime_time_windows';
    IF v_pw IS NULL OR v_pw = 'null'::jsonb THEN v_pw := '[]'::jsonb; END IF;
    IF jsonb_typeof(v_pw) <> 'array' THEN
      RAISE EXCEPTION 'default_prime_time_windows_invalid' USING ERRCODE = 'P0001';
    END IF;
    FOR v_w IN SELECT * FROM jsonb_array_elements(v_pw) LOOP
      IF (v_w->>'day_of_week') IS NULL OR (v_w->>'day_of_week') !~ '^[0-9]+$'
         OR (v_w->>'day_of_week')::int < 0 OR (v_w->>'day_of_week')::int > 6 THEN
        RAISE EXCEPTION 'default_prime_time_window_day_invalid' USING ERRCODE = 'P0001';
      END IF;
      IF (v_w->>'start_time') IS NULL OR (v_w->>'end_time') IS NULL THEN
        RAISE EXCEPTION 'default_prime_time_window_times_required' USING ERRCODE = 'P0001';
      END IF;
      IF (v_w->>'start_time')::time >= (v_w->>'end_time')::time THEN
        RAISE EXCEPTION 'default_prime_time_window_times_inverted' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    UPDATE venues SET default_prime_time_windows = v_pw WHERE id = v_venue_id;
    v_changed := array_append(v_changed, 'default_prime_time_windows');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RAISE EXCEPTION 'no_recognised_keys' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'venue_updated', 'venue', v_venue_id,
    jsonb_build_object('venue_id', v_venue_id, 'changed_keys', v_changed, 'updates', p_updates)
  );

  PERFORM public.notify_venue_change(v_venue_id, 'venue_updated');

  RETURN jsonb_build_object('ok', true, 'changed_keys', v_changed);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. venue_get_state — expose payment_link on the venue object (rebuilt on live body)
-- ─────────────────────────────────────────────────────────────────────────────
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
    SELECT ct.id, ct.competition_id, ct.team_id, ct.status, ct.registered_at, t.name AS team_name
    FROM competition_teams ct LEFT JOIN teams t ON t.id = ct.team_id
    WHERE ct.competition_id IN (SELECT id FROM v_competitions) AND ct.status = 'pending'),
  v_teams_dir AS (
    SELECT DISTINCT t.id, t.name, t.primary_colour, t.secondary_colour
    FROM teams t
    JOIN competition_teams ct ON ct.team_id = t.id
    WHERE ct.competition_id IN (SELECT id FROM v_competitions))
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
        'severity', i.severity, 'reported_by', i.reported_by, 'created_at', i.created_at) ORDER BY i.created_at DESC)
      FROM incidents i WHERE i.venue_id = v_venue_id AND i.resolved_at IS NULL), '[]'::jsonb),
    'caller', jsonb_build_object('actor_type', v_caller.actor_type, 'actor_ident', v_caller.actor_ident)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
