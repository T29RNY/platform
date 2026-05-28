-- Down for 135 — restore the mig 106 venue_update_pitch body (no booking_windows
-- key) and the mig 113 venue_get_state body (no booking_windows in the pitches
-- projection). Strict revert. NOTE: callers must not roll this back while a
-- later migration still depends on booking_windows being editable/exposed.

CREATE OR REPLACE FUNCTION public.venue_update_pitch(
  p_venue_token text,
  p_pitch_id    uuid,
  p_updates     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_pitch record;
  v_was_active boolean;
  v_will_close boolean := false;
  v_capacity int;
  v_mw jsonb;
  v_w jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_reason text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_pitch_id IS NULL THEN
    RAISE EXCEPTION 'pitch_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object'
     OR p_updates = '{}'::jsonb THEN
    RAISE EXCEPTION 'updates_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, venue_id, active INTO v_pitch
  FROM playing_areas WHERE id = p_pitch_id;
  IF v_pitch.id IS NULL THEN
    RAISE EXCEPTION 'pitch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_pitch.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  v_was_active := v_pitch.active;

  IF p_updates ? 'name' THEN
    IF NULLIF(trim(p_updates->>'name'), '') IS NULL
       OR length(trim(p_updates->>'name')) > 120 THEN
      RAISE EXCEPTION 'pitch_name_invalid' USING ERRCODE = 'P0001';
    END IF;
    UPDATE playing_areas SET name = trim(p_updates->>'name') WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'name');
  END IF;
  IF p_updates ? 'surface' THEN
    UPDATE playing_areas SET surface = NULLIF(p_updates->>'surface', '') WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'surface');
  END IF;
  IF p_updates ? 'capacity' THEN
    IF (p_updates->>'capacity') IS NULL THEN
      UPDATE playing_areas SET capacity = NULL WHERE id = p_pitch_id;
    ELSE
      v_capacity := (p_updates->>'capacity')::int;
      IF v_capacity < 1 THEN
        RAISE EXCEPTION 'pitch_capacity_invalid' USING ERRCODE = 'P0001';
      END IF;
      UPDATE playing_areas SET capacity = v_capacity WHERE id = p_pitch_id;
    END IF;
    v_changed := array_append(v_changed, 'capacity');
  END IF;
  IF p_updates ? 'active' THEN
    IF v_was_active AND NOT (p_updates->>'active')::boolean THEN
      v_will_close := true;
    END IF;
    UPDATE playing_areas SET active = (p_updates->>'active')::boolean WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'active');
  END IF;
  IF p_updates ? 'is_available' THEN
    UPDATE playing_areas SET is_available = (p_updates->>'is_available')::boolean WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'is_available');
  END IF;
  IF p_updates ? 'sort_order' THEN
    UPDATE playing_areas SET sort_order = (p_updates->>'sort_order')::int WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'sort_order');
  END IF;
  IF p_updates ? 'maintenance_windows' THEN
    v_mw := p_updates->'maintenance_windows';
    IF v_mw IS NULL OR v_mw = 'null'::jsonb THEN
      v_mw := '[]'::jsonb;
    END IF;
    IF jsonb_typeof(v_mw) <> 'array' THEN
      RAISE EXCEPTION 'maintenance_windows_invalid' USING ERRCODE = 'P0001';
    END IF;
    FOR v_w IN SELECT * FROM jsonb_array_elements(v_mw) LOOP
      IF (v_w->>'start_date') IS NULL OR (v_w->>'end_date') IS NULL THEN
        RAISE EXCEPTION 'maintenance_window_dates_required' USING ERRCODE = 'P0001';
      END IF;
      IF (v_w->>'start_date')::date > (v_w->>'end_date')::date THEN
        RAISE EXCEPTION 'maintenance_window_dates_inverted' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    UPDATE playing_areas SET maintenance_windows = v_mw WHERE id = p_pitch_id;
    v_changed := array_append(v_changed, 'maintenance_windows');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RAISE EXCEPTION 'no_recognised_keys' USING ERRCODE = 'P0001';
  END IF;

  v_reason := CASE WHEN v_will_close THEN 'pitch_closed' ELSE 'pitch_updated' END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    v_reason, 'playing_area', p_pitch_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'changed_keys', v_changed,
                       'updates', p_updates)
  );

  PERFORM public.notify_venue_change(v_venue_id, v_reason);

  RETURN jsonb_build_object('ok', true, 'pitch_id', p_pitch_id,
                            'changed_keys', v_changed,
                            'pitch_closed', v_will_close);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_update_pitch(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_pitch(text, uuid, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.venue_get_state(p_venue_token text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
        'display_pin', v.display_pin, 'active', v.active, 'subscription_status', v.subscription_status,
        'trial_ends_at', v.trial_ends_at, 'created_at', v.created_at) FROM venues v WHERE v.id = v_venue_id),
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
        'maintenance_windows', pa.maintenance_windows, 'sort_order', pa.sort_order) ORDER BY pa.sort_order, pa.name)
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
