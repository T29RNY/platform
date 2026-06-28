-- Migration 453 — Modular Epic D3: venue-operator tournament COMMERCIAL + SPORTS-DAY
--
-- Adds NO schema. Every table/column (tournament_sponsors, equipment_bookings.tournament_event_id,
-- tournament_events.player_of_tournament_name/team + .branding + .points_config, performance_events,
-- performance_results) and the manage_tournaments cap already exist (migs 326/327 + D1 mig 452).
--
-- D3 = venue-token SIBLINGS of the club_admin_* commercial chain (mig 327) and the
-- performance/sports-day chain (migs 326/328). Each body clones the club_admin_* logic verbatim;
-- the ONLY diff is the auth block — swapped for the shared SECDEF helper
-- _authorise_venue_tournament(p_venue_token, p_tournament_event_id) shipped in D1 (mig 452), which:
--   resolve_venue_caller(token) → venue_id  +  tournament-belongs-to-this-venue check
--   + admit on owner role OR manage_facility OR manage_tournaments
--   + _club_feature_enabled ONLY when the tournament is club-owned (club_id NOT NULL).
-- Each write keeps its own audit_events row (HR#9), team_id = COALESCE(club_id, venue_id),
-- actor_type/actor_identifier from the helper. Functions taking a CHILD id (sponsor/booking/
-- performance_event) resolve the parent tournament_event_id first, then call the helper.
--
-- COMMERCIAL (9):
--   1. venue_add_sponsor                        (write)
--   2. venue_list_sponsors                      (read)
--   3. venue_remove_sponsor                     (write, child id)
--   4. venue_set_branding                       (write)
--   5. venue_set_player_of_tournament           (write)
--   6. venue_get_equipment_for_tournament       (read, venue catalogue)
--   7. venue_book_equipment_for_tournament      (write)
--   8. venue_list_tournament_equipment_bookings (read)
--   9. venue_cancel_equipment_booking           (write, child id)
-- SPORTS-DAY (6):
--   10. venue_set_performance_config            (write)
--   11. venue_add_performance_event             (write)
--   12. venue_list_performance_events           (read)
--   13. venue_record_result                     (write, child id = performance_event)
--   14. venue_get_performance_results           (read, child id)
--   15. venue_get_sports_day_standings          (read)
--
-- All SECURITY DEFINER, SET search_path, REVOKE FROM public + GRANT anon,authenticated
-- (token-auth: caller may be anon-with-token or an authenticated venue session — matches D1).
-- Public read shape (get_tournament_public) ALREADY exposes sponsors/branding/POT/performance
-- (migs 326/327) and D1 made its club JOIN a LEFT JOIN — no public-read change here.

-- ============================================================================
-- COMMERCIAL
-- ============================================================================

-- ─── 1. venue_add_sponsor ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_add_sponsor(
  p_venue_token         text,
  p_tournament_event_id uuid,
  p_name                text,
  p_logo_url            text DEFAULT NULL,
  p_website_url         text DEFAULT NULL,
  p_display_order       int  DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth       record;
  v_name       text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_sponsor_id uuid;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO tournament_sponsors (tournament_event_id, name, logo_url, website_url, display_order)
  VALUES (
    p_tournament_event_id,
    v_name,
    NULLIF(btrim(COALESCE(p_logo_url, '')), ''),
    NULLIF(btrim(COALESCE(p_website_url, '')), ''),
    COALESCE(p_display_order, 0)
  )
  RETURNING id INTO v_sponsor_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_sponsor_added', 'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id, 'sponsor_id', v_sponsor_id, 'name', v_name));

  RETURN jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_add_sponsor(text, uuid, text, text, text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_add_sponsor(text, uuid, text, text, text, int) TO anon, authenticated;

-- ─── 2. venue_list_sponsors ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_sponsors(
  p_venue_token         text,
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth record;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sponsor_id',    ts.id,
      'name',          ts.name,
      'logo_url',      ts.logo_url,
      'website_url',   ts.website_url,
      'display_order', ts.display_order,
      'active',        ts.active
    ) ORDER BY ts.display_order, ts.name)
    FROM tournament_sponsors ts
    WHERE ts.tournament_event_id = p_tournament_event_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_sponsors(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_sponsors(text, uuid) TO anon, authenticated;

-- ─── 3. venue_remove_sponsor (child id → resolve tournament first) ─────────────
CREATE OR REPLACE FUNCTION public.venue_remove_sponsor(
  p_venue_token text,
  p_sponsor_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth  record;
  v_te_id uuid;
BEGIN
  SELECT ts.tournament_event_id INTO v_te_id
    FROM tournament_sponsors ts WHERE ts.id = p_sponsor_id LIMIT 1;
  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'sponsor_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te_id);

  DELETE FROM tournament_sponsors WHERE id = p_sponsor_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_sponsor_removed', 'tournament_sponsor', p_sponsor_id::text,
          jsonb_build_object('tournament_event_id', v_te_id, 'sponsor_id', p_sponsor_id));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_remove_sponsor(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_remove_sponsor(text, uuid) TO anon, authenticated;

-- ─── 4. venue_set_branding ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_branding(
  p_venue_token         text,
  p_tournament_event_id uuid,
  p_primary_colour      text DEFAULT NULL,
  p_secondary_colour    text DEFAULT NULL,
  p_custom_logo_url     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth record;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  UPDATE tournament_events
     SET branding = jsonb_build_object(
           'primary_colour',   NULLIF(btrim(COALESCE(p_primary_colour, '')), ''),
           'secondary_colour', NULLIF(btrim(COALESCE(p_secondary_colour, '')), ''),
           'custom_logo_url',  NULLIF(btrim(COALESCE(p_custom_logo_url, '')), '')
         )
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_branding_updated', 'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_set_branding(text, uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_set_branding(text, uuid, text, text, text) TO anon, authenticated;

-- ─── 5. venue_set_player_of_tournament ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_player_of_tournament(
  p_venue_token         text,
  p_tournament_event_id uuid,
  p_name                text,
  p_team_name           text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth record;
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET player_of_tournament_name = v_name,
         player_of_tournament_team = NULLIF(btrim(COALESCE(p_team_name, '')), '')
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_pot_set', 'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id, 'name', v_name, 'team_name', p_team_name));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_set_player_of_tournament(text, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_set_player_of_tournament(text, uuid, text, text) TO anon, authenticated;

-- ─── 6. venue_get_equipment_for_tournament (venue catalogue via helper venue_id) ─
CREATE OR REPLACE FUNCTION public.venue_get_equipment_for_tournament(
  p_venue_token         text,
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth record;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'equipment_id',      e.id,
      'name',              e.name,
      'category',          e.category,
      'quantity',          e.quantity,
      'default_fee_pence', e.default_fee_pence,
      'deposit_pence',     e.deposit_pence,
      'hire_unit',         e.hire_unit,
      'condition',         e.condition
    ) ORDER BY e.category, e.name)
    FROM equipment e
    WHERE e.venue_id = v_auth.venue_id
      AND e.active = true
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_get_equipment_for_tournament(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_get_equipment_for_tournament(text, uuid) TO anon, authenticated;

-- ─── 7. venue_book_equipment_for_tournament ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_book_equipment_for_tournament(
  p_venue_token         text,
  p_tournament_event_id uuid,
  p_equipment_id        uuid,
  p_qty                 int,
  p_start_at            timestamptz,
  p_end_at              timestamptz,
  p_due_back_at         timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth       record;
  v_te_name    text;
  v_eq         record;
  v_peak       int;
  v_free       int;
  v_booking_id uuid;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_te_name FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;

  SELECT * INTO v_eq FROM equipment WHERE id = p_equipment_id FOR UPDATE;
  IF v_eq.id IS NULL THEN
    RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_eq.venue_id <> v_auth.venue_id THEN
    RAISE EXCEPTION 'equipment_not_at_venue' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_eq.active THEN
    RAISE EXCEPTION 'equipment_inactive' USING ERRCODE = 'P0001';
  END IF;

  v_peak := public._equipment_peak_committed(p_equipment_id, p_start_at, p_end_at);
  v_free := v_eq.quantity - v_peak;
  IF p_qty > v_free THEN
    RAISE EXCEPTION 'insufficient_availability' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO equipment_bookings (
    equipment_id, venue_id, booked_by_name,
    qty, start_at, end_at, due_back_at,
    tournament_event_id, status
  )
  VALUES (
    p_equipment_id, v_auth.venue_id, 'Tournament: ' || v_te_name,
    p_qty, p_start_at, p_end_at, p_due_back_at,
    p_tournament_event_id, 'confirmed'
  )
  RETURNING id INTO v_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_equipment_booked', 'equipment_booking', v_booking_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id, 'booking_id', v_booking_id,
                             'equipment_id', p_equipment_id, 'qty', p_qty));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_book_equipment_for_tournament(text, uuid, uuid, int, timestamptz, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_book_equipment_for_tournament(text, uuid, uuid, int, timestamptz, timestamptz, timestamptz) TO anon, authenticated;

-- ─── 8. venue_list_tournament_equipment_bookings ──────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_tournament_equipment_bookings(
  p_venue_token         text,
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth record;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'booking_id',     eb.id,
      'equipment_id',   eb.equipment_id,
      'equipment_name', e.name,
      'category',       e.category,
      'qty',            eb.qty,
      'start_at',       eb.start_at,
      'end_at',         eb.end_at,
      'due_back_at',    eb.due_back_at,
      'returned_at',    eb.returned_at,
      'status',         eb.status,
      'amount_pence',   eb.amount_pence
    ) ORDER BY eb.start_at, e.name)
    FROM equipment_bookings eb
    JOIN equipment e ON e.id = eb.equipment_id
    WHERE eb.tournament_event_id = p_tournament_event_id
      AND eb.status NOT IN ('cancelled', 'declined')
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_tournament_equipment_bookings(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_tournament_equipment_bookings(text, uuid) TO anon, authenticated;

-- ─── 9. venue_cancel_equipment_booking (child id → resolve tournament first) ───
CREATE OR REPLACE FUNCTION public.venue_cancel_equipment_booking(
  p_venue_token text,
  p_booking_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth   record;
  v_status text;
  v_te_id  uuid;
BEGIN
  SELECT eb.status, eb.tournament_event_id INTO v_status, v_te_id
    FROM equipment_bookings eb WHERE eb.id = p_booking_id LIMIT 1;
  -- Only director/operator-created bookings carry a tournament link
  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te_id);

  IF v_status IN ('out', 'returned', 'cancelled') THEN
    RAISE EXCEPTION 'cannot_cancel' USING ERRCODE = 'P0001';
  END IF;

  UPDATE equipment_bookings SET status = 'cancelled' WHERE id = p_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_equipment_booking_cancelled', 'equipment_booking', p_booking_id::text,
          jsonb_build_object('tournament_event_id', v_te_id, 'booking_id', p_booking_id));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_equipment_booking(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_cancel_equipment_booking(text, uuid) TO anon, authenticated;

-- ============================================================================
-- SPORTS-DAY / PERFORMANCE
-- ============================================================================

-- ─── 10. venue_set_performance_config ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_performance_config(
  p_venue_token         text,
  p_tournament_event_id uuid,
  p_points_config       jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth record;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF EXISTS (
    SELECT 1 FROM performance_results pr
    JOIN performance_events pe ON pe.id = pr.performance_event_id
    WHERE pe.tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'results_already_recorded' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_points_config) <> 'object' THEN
    RAISE EXCEPTION 'invalid_points_config' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events SET points_config = p_points_config WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_performance_config_updated', 'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id, 'points_config', p_points_config));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_set_performance_config(text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_set_performance_config(text, uuid, jsonb) TO anon, authenticated;

-- ─── 11. venue_add_performance_event ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_add_performance_event(
  p_venue_token          text,
  p_tournament_event_id  uuid,
  p_name                 text,
  p_measurement_type     text,
  p_unit                 text,
  p_attempts_per_athlete int         DEFAULT 1,
  p_category             text        DEFAULT NULL,
  p_scheduled_time       timestamptz DEFAULT NULL,
  p_display_order        int         DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth     record;
  v_event_id uuid;
  v_name     text := NULLIF(btrim(p_name), '');
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_measurement_type NOT IN ('time_asc','time_desc','distance','height','weight') THEN
    RAISE EXCEPTION 'invalid_measurement_type' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(btrim(p_unit), '') IS NULL THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO performance_events (
    tournament_event_id, name, sport, measurement_type, unit,
    attempts_per_athlete, category, scheduled_time, display_order
  )
  VALUES (
    p_tournament_event_id, v_name, 'athletics', p_measurement_type, btrim(p_unit),
    COALESCE(p_attempts_per_athlete, 1), p_category, p_scheduled_time, p_display_order
  )
  RETURNING id INTO v_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_performance_event_added', 'performance_event', v_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id, 'performance_event_id', v_event_id, 'name', v_name));

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_add_performance_event(text, uuid, text, text, text, int, text, timestamptz, int) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_add_performance_event(text, uuid, text, text, text, int, text, timestamptz, int) TO anon, authenticated;

-- ─── 12. venue_list_performance_events ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_performance_events(
  p_venue_token         text,
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth record;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'event_id',             pe.id,
      'name',                 pe.name,
      'measurement_type',     pe.measurement_type,
      'unit',                 pe.unit,
      'attempts_per_athlete', pe.attempts_per_athlete,
      'category',             pe.category,
      'scheduled_time',       pe.scheduled_time,
      'display_order',        pe.display_order,
      'result_count', (
        SELECT COUNT(*) FROM performance_results pr
        WHERE pr.performance_event_id = pe.id
          AND pr.status = 'recorded'
      )
    ) ORDER BY COALESCE(pe.display_order, 9999), pe.scheduled_time NULLS LAST, pe.name)
    FROM performance_events pe
    WHERE pe.tournament_event_id = p_tournament_event_id
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_performance_events(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_performance_events(text, uuid) TO anon, authenticated;

-- ─── 13. venue_record_result (child id = performance_event → resolve tournament) ─
CREATE OR REPLACE FUNCTION public.venue_record_result(
  p_venue_token          text,
  p_performance_event_id uuid,
  p_athlete_name         text,
  p_competition_team_id  uuid,
  p_value                numeric,
  p_attempt_number       int  DEFAULT 1,
  p_status               text DEFAULT 'recorded'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth          record;
  v_tournament_id uuid;
  v_result_id     uuid;
  v_name          text := NULLIF(btrim(p_athlete_name), '');
BEGIN
  SELECT pe.tournament_event_id INTO v_tournament_id
    FROM performance_events pe WHERE pe.id = p_performance_event_id LIMIT 1;
  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_tournament_id);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'athlete_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'competition_team_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    WHERE ct.id = p_competition_team_id
      AND c.tournament_event_id = v_tournament_id
  ) THEN
    RAISE EXCEPTION 'team_not_in_tournament' USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('recorded','dns','dnf','disqualified') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO performance_results (
    performance_event_id, athlete_name, competition_team_id,
    value, attempt_number, status, recorded_by
  )
  VALUES (
    p_performance_event_id, v_name, p_competition_team_id,
    p_value, COALESCE(p_attempt_number, 1), p_status, auth.uid()
  )
  ON CONFLICT (performance_event_id, competition_team_id, athlete_name, attempt_number)
  DO UPDATE SET
    value       = EXCLUDED.value,
    status      = EXCLUDED.status,
    recorded_at = now(),
    recorded_by = EXCLUDED.recorded_by
  RETURNING id INTO v_result_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
          'tournament_result_recorded', 'performance_result', v_result_id::text,
          jsonb_build_object('performance_event_id', p_performance_event_id, 'result_id', v_result_id,
                             'athlete_name', v_name, 'value', p_value, 'status', p_status));

  RETURN jsonb_build_object('ok', true, 'result_id', v_result_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_record_result(text, uuid, text, uuid, numeric, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_record_result(text, uuid, text, uuid, numeric, int, text) TO anon, authenticated;

-- ─── 14. venue_get_performance_results (child id) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_get_performance_results(
  p_venue_token          text,
  p_performance_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth          record;
  v_tournament_id uuid;
  v_mtype         text;
BEGIN
  SELECT pe.tournament_event_id, pe.measurement_type INTO v_tournament_id, v_mtype
    FROM performance_events pe WHERE pe.id = p_performance_event_id LIMIT 1;
  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_tournament_id);

  RETURN COALESCE((
    WITH best_attempts AS (
      SELECT
        pr.athlete_name,
        pr.competition_team_id,
        ct.team_name,
        CASE WHEN v_mtype = 'time_asc'
             THEN MIN(CASE WHEN pr.status = 'recorded' THEN pr.value END)
             ELSE MAX(CASE WHEN pr.status = 'recorded' THEN pr.value END)
        END AS best_value,
        MAX(CASE WHEN pr.status <> 'recorded' THEN pr.status END) AS non_recorded_status,
        jsonb_agg(jsonb_build_object(
          'attempt_number', pr.attempt_number,
          'value',          pr.value,
          'status',         pr.status
        ) ORDER BY pr.attempt_number) AS attempts
      FROM performance_results pr
      JOIN competition_teams ct ON ct.id = pr.competition_team_id
      WHERE pr.performance_event_id = p_performance_event_id
      GROUP BY pr.athlete_name, pr.competition_team_id, ct.team_name
    ),
    ranked AS (
      SELECT *,
        CASE WHEN best_value IS NOT NULL THEN RANK() OVER (ORDER BY best_value ASC)  ELSE NULL END AS rank_asc,
        CASE WHEN best_value IS NOT NULL THEN RANK() OVER (ORDER BY best_value DESC) ELSE NULL END AS rank_desc
      FROM best_attempts
    )
    SELECT jsonb_agg(jsonb_build_object(
      'athlete_name',        r.athlete_name,
      'team_name',           r.team_name,
      'competition_team_id', r.competition_team_id,
      'best_value',          r.best_value,
      'status',              COALESCE(r.non_recorded_status, 'recorded'),
      'rank',                CASE WHEN v_mtype = 'time_asc' THEN r.rank_asc ELSE r.rank_desc END,
      'attempts',            r.attempts
    ) ORDER BY
        CASE WHEN r.best_value IS NULL THEN 1 ELSE 0 END,
        CASE WHEN v_mtype = 'time_asc' THEN r.rank_asc ELSE r.rank_desc END NULLS LAST,
        r.athlete_name
    )
    FROM ranked r
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_get_performance_results(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_get_performance_results(text, uuid) TO anon, authenticated;

-- ─── 15. venue_get_sports_day_standings ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_get_sports_day_standings(
  p_venue_token         text,
  p_tournament_event_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_auth          record;
  v_points_config jsonb;
BEGIN
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  SELECT points_config INTO v_points_config FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;

  RETURN COALESCE((
    WITH event_results AS (
      SELECT
        pe.id    AS event_id,
        pe.measurement_type,
        pr.competition_team_id,
        pr.athlete_name,
        CASE WHEN pe.measurement_type = 'time_asc'
             THEN MIN(CASE WHEN pr.status = 'recorded' THEN pr.value END)
             ELSE MAX(CASE WHEN pr.status = 'recorded' THEN pr.value END)
        END AS best_value
      FROM performance_events pe
      JOIN performance_results pr ON pr.performance_event_id = pe.id
      WHERE pe.tournament_event_id = p_tournament_event_id
        AND pr.status = 'recorded'
      GROUP BY pe.id, pe.measurement_type, pr.competition_team_id, pr.athlete_name
    ),
    ranked_results AS (
      SELECT
        er.*,
        CASE WHEN er.measurement_type = 'time_asc'
             THEN RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value ASC)
             ELSE RANK() OVER (PARTITION BY er.event_id ORDER BY er.best_value DESC)
        END AS finish_rank
      FROM event_results er
      WHERE er.best_value IS NOT NULL
    ),
    team_points AS (
      SELECT
        rr.competition_team_id,
        ct.team_name,
        SUM(COALESCE((v_points_config->>(rr.finish_rank::text))::int, 0)) AS total_points,
        COUNT(CASE WHEN rr.finish_rank = 1 THEN 1 END)::int AS gold,
        COUNT(CASE WHEN rr.finish_rank = 2 THEN 1 END)::int AS silver,
        COUNT(CASE WHEN rr.finish_rank = 3 THEN 1 END)::int AS bronze,
        COUNT(DISTINCT rr.event_id)::int AS events_entered
      FROM ranked_results rr
      JOIN competition_teams ct ON ct.id = rr.competition_team_id
      GROUP BY rr.competition_team_id, ct.team_name
    )
    SELECT jsonb_agg(jsonb_build_object(
      'competition_team_id', tp.competition_team_id,
      'team_name',           tp.team_name,
      'points',              tp.total_points,
      'gold',                tp.gold,
      'silver',              tp.silver,
      'bronze',              tp.bronze,
      'events_entered',      tp.events_entered
    ) ORDER BY tp.total_points DESC, tp.gold DESC, tp.silver DESC, tp.bronze DESC, tp.team_name ASC)
    FROM team_points tp
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_get_sports_day_standings(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_get_sports_day_standings(text, uuid) TO anon, authenticated;
