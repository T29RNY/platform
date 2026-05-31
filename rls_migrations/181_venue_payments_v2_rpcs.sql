-- Migration 181 — Venue Payments Ledger V2 (RPCs + charge auto-creation hooks).
-- Per VENUE_PAYMENTS_SCOPE.md. Builds on V1 schema (mig 180).
--
-- Adds:
--   _recompute_charge_status(charge_id)  — derive unpaid/partial/paid from non-voided
--                                          instalments vs amount_due (preserves 'refunded').
--   venue_record_payment(...)            — append a payment instalment (write).
--   venue_void_payment(...)              — soft-void an instalment (write).
--   venue_get_charges(...)               — list charges + balances + collection summary (read).
-- Hooks charge auto-creation into existing RPCs (rebuilt on their LIVE bodies):
--   venue_confirm_booking   → booking charge (amount = booking.amount_pence else
--                             playing_areas.default_fee_pence; SKIP when no fee >0).
--   venue_generate_fixtures → per-team fixture charges per league_config.fixture_fee_payer
--                             (amount = league_config.fixture_fee_pence; SKIP when no fee >0).
--   venue_update_fixture_status → on 'void', mark that fixture's charges 'refunded'
--                             (payments left intact; postpone/walkover/forfeit untouched).
-- Extends notify_venue_change whitelist with 'payment_recorded','payment_voided'.
--
-- Operator decisions (session 63): void→refund charges/keep payments; zero-fee→no charge;
-- V2 scope = hooks + record/void + get_charges (set_charge_due + per-fixture add/void → V3).
--
-- All write RPCs: SECDEF, search_path pinned, resolve_venue_caller auth, audited
-- (audit_events.team_id is NOT NULL → COALESCE(team_id, venue_id)), notify_venue_change.

-- ── status recompute helper ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._recompute_charge_status(p_charge_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_due int; v_refunded boolean; v_paid int;
BEGIN
  SELECT amount_due_pence, (status = 'refunded') INTO v_due, v_refunded
  FROM venue_charges WHERE id = p_charge_id;
  IF v_due IS NULL THEN RETURN; END IF;
  IF v_refunded THEN RETURN; END IF;  -- cancelled charge: leave terminal status

  SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_pence ELSE -amount_pence END), 0)
    INTO v_paid FROM venue_payments WHERE charge_id = p_charge_id AND voided_at IS NULL;

  UPDATE venue_charges SET status = CASE
      WHEN v_paid <= 0       THEN 'unpaid'
      WHEN v_paid >= v_due   THEN 'paid'
      ELSE 'partial' END
   WHERE id = p_charge_id;
END;
$function$;
REVOKE ALL ON FUNCTION public._recompute_charge_status(uuid) FROM PUBLIC;

-- ── notify whitelist: add the two payment reasons ─────────────────────────────
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
    'incident_resolved',
    'booking_requested','booking_confirmed','booking_declined','booking_cancelled','booking_superseded',
    'payment_recorded','payment_voided','charge_updated'
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

-- ── venue_record_payment ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_record_payment(
  p_venue_token text, p_charge_id uuid, p_amount_pence int,
  p_method text, p_external_ref text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_charge record; v_payment_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_amount_pence IS NULL OR p_amount_pence <= 0 THEN
    RAISE EXCEPTION 'amount_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_method NOT IN ('cash','bank_transfer','card','other') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = 'P0001', DETAIL = p_method;
  END IF;

  SELECT * INTO v_charge FROM venue_charges WHERE id = p_charge_id;
  IF v_charge.id IS NULL THEN RAISE EXCEPTION 'charge_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_charge.venue_id <> v_venue_id THEN RAISE EXCEPTION 'charge_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_charge.status = 'refunded' THEN RAISE EXCEPTION 'charge_refunded' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO venue_payments (charge_id, kind, amount_pence, method, external_ref, note, taken_by)
  VALUES (p_charge_id, 'payment', p_amount_pence, p_method,
          NULLIF(p_external_ref, ''), NULLIF(p_note, ''), v_caller.actor_ident)
  RETURNING id INTO v_payment_id;

  PERFORM public._recompute_charge_status(p_charge_id);

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_charge.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'payment_recorded', 'venue_payment', v_payment_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'charge_id', p_charge_id,
                             'amount_pence', p_amount_pence, 'method', p_method));

  PERFORM public.notify_venue_change(v_venue_id, 'payment_recorded');

  RETURN jsonb_build_object('ok', true, 'payment_id', v_payment_id, 'charge_id', p_charge_id,
    'charge_status', (SELECT status FROM venue_charges WHERE id = p_charge_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_record_payment(text, uuid, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_record_payment(text, uuid, int, text, text, text) TO anon, authenticated;

-- ── venue_void_payment ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_void_payment(p_venue_token text, p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_pay record; v_charge record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_pay FROM venue_payments WHERE id = p_payment_id;
  IF v_pay.id IS NULL THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_charge FROM venue_charges WHERE id = v_pay.charge_id;
  IF v_charge.venue_id <> v_venue_id THEN RAISE EXCEPTION 'payment_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_pay.voided_at IS NOT NULL THEN RAISE EXCEPTION 'payment_already_voided' USING ERRCODE = 'P0001'; END IF;

  UPDATE venue_payments SET voided_at = now() WHERE id = p_payment_id;
  PERFORM public._recompute_charge_status(v_pay.charge_id);

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_charge.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'payment_voided', 'venue_payment', p_payment_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'charge_id', v_pay.charge_id, 'amount_pence', v_pay.amount_pence));

  PERFORM public.notify_venue_change(v_venue_id, 'payment_voided');

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'charge_id', v_pay.charge_id,
    'charge_status', (SELECT status FROM venue_charges WHERE id = v_pay.charge_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_void_payment(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_void_payment(text, uuid) TO anon, authenticated;

-- ── venue_get_charges (read) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_get_charges(
  p_venue_token text, p_status text DEFAULT NULL, p_source_type text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  WITH ch AS (
    SELECT c.id, c.source_type, c.source_id, c.team_id, c.competition_id,
           c.amount_due_pence, c.status, c.due_date, c.created_at,
           COALESCE((SELECT SUM(CASE WHEN p.kind='payment' THEN p.amount_pence ELSE -p.amount_pence END)
                     FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid_pence
    FROM venue_charges c
    WHERE c.venue_id = v_venue_id
      AND (p_status IS NULL OR c.status = p_status)
      AND (p_source_type IS NULL OR c.source_type = p_source_type)
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'charge_count',      (SELECT count(*) FROM ch),
      'owed_pence',        COALESCE((SELECT SUM(amount_due_pence) FROM ch WHERE status <> 'refunded'), 0),
      'collected_pence',   COALESCE((SELECT SUM(paid_pence) FROM ch WHERE status <> 'refunded'), 0),
      'outstanding_pence', COALESCE((SELECT SUM(GREATEST(amount_due_pence - paid_pence, 0)) FROM ch WHERE status <> 'refunded'), 0),
      'collection_rate',   (SELECT CASE WHEN COALESCE(SUM(amount_due_pence),0) = 0 THEN NULL
                              ELSE round(100.0 * SUM(paid_pence) / SUM(amount_due_pence), 1) END
                            FROM ch WHERE status <> 'refunded'),
      'by_status', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM ch GROUP BY status) s), '{}'::jsonb)
    ),
    'charges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'source_type', source_type, 'source_id', source_id, 'team_id', team_id,
        'competition_id', competition_id, 'amount_due_pence', amount_due_pence,
        'paid_pence', paid_pence, 'balance_pence', GREATEST(amount_due_pence - paid_pence, 0),
        'status', status, 'due_date', due_date) ORDER BY due_date DESC NULLS LAST, created_at DESC)
      FROM (SELECT * FROM ch ORDER BY due_date DESC NULLS LAST, created_at DESC LIMIT GREATEST(p_limit, 0)) lim
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_get_charges(text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_get_charges(text, text, text, int) TO anon, authenticated;

-- ── venue_set_charge_due (override auto-filled amount due) ─────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_charge_due(
  p_venue_token text, p_charge_id uuid, p_amount_pence int)
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

  IF p_amount_pence IS NULL OR p_amount_pence < 0 THEN
    RAISE EXCEPTION 'amount_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_charge FROM venue_charges WHERE id = p_charge_id;
  IF v_charge.id IS NULL THEN RAISE EXCEPTION 'charge_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_charge.venue_id <> v_venue_id THEN RAISE EXCEPTION 'charge_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_charge.status = 'refunded' THEN RAISE EXCEPTION 'charge_refunded' USING ERRCODE = 'P0001'; END IF;

  UPDATE venue_charges SET amount_due_pence = p_amount_pence WHERE id = p_charge_id;
  PERFORM public._recompute_charge_status(p_charge_id);  -- partial/paid may flip with the new due

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_charge.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'charge_due_set', 'venue_charge', p_charge_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'old_pence', v_charge.amount_due_pence, 'new_pence', p_amount_pence));

  PERFORM public.notify_venue_change(v_venue_id, 'charge_updated');

  RETURN jsonb_build_object('ok', true, 'charge_id', p_charge_id, 'amount_due_pence', p_amount_pence,
    'charge_status', (SELECT status FROM venue_charges WHERE id = p_charge_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_set_charge_due(text, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_set_charge_due(text, uuid, int) TO anon, authenticated;

-- ── HOOK 1: venue_confirm_booking (+ booking charge) ──────────────────────────
CREATE OR REPLACE FUNCTION public.venue_confirm_booking(p_venue_token text, p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_bk record;
  v_fee int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_bk FROM pitch_bookings WHERE id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.venue_id <> v_venue_id THEN RAISE EXCEPTION 'booking_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.status <> 'requested' THEN RAISE EXCEPTION 'booking_not_pending' USING ERRCODE = 'P0001', DETAIL = v_bk.status; END IF;

  UPDATE pitch_bookings SET status = 'confirmed' WHERE id = p_booking_id;

  -- V2: auto-create a booking charge when a fee is configured (booking amount, else pitch default)
  SELECT COALESCE(NULLIF(v_bk.amount_pence, 0), pa.default_fee_pence) INTO v_fee
  FROM playing_areas pa WHERE pa.id = v_bk.playing_area_id;
  IF v_fee IS NOT NULL AND v_fee > 0 THEN
    INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_venue_id, 'booking', p_booking_id::text, v_bk.team_id, NULL, v_fee, 'unpaid', v_bk.booking_date)
    ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'pitch_booking', p_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id, 'charge_fee_pence', v_fee));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_confirmed'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'confirmed');
END;
$function$;

-- ── HOOK 2: venue_generate_fixtures (+ per-team fixture charges) ───────────────
CREATE OR REPLACE FUNCTION public.venue_generate_fixtures(p_venue_token text, p_competition_id uuid, p_fixtures jsonb, p_displace_booking_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_league_id text;
  v_season_id uuid;
  v_season_start date;
  v_season_end date;
  v_competition record;
  v_fixture_count int;
  v_active_team_ids text[];
  v_venue_pitch_ids uuid[];
  v_fx jsonb;
  v_home text;
  v_away text;
  v_date date;
  v_kickoff_text text;
  v_kickoff time;
  v_pitch uuid;
  v_lc_slot int;
  v_start timestamptz;
  v_range tstzrange;
  v_clash_ids uuid[] := '{}'::uuid[];
  v_undisplaced uuid[];
  v_b record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT c.id, c.season_id, s.league_id, s.start_date, s.end_date,
         l.venue_id AS l_venue
  INTO v_competition
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE c.id = p_competition_id;

  IF v_competition.id IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_competition.l_venue <> v_venue_id THEN
    RAISE EXCEPTION 'competition_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_competition.league_id;
  v_season_id := v_competition.season_id;
  v_season_start := v_competition.start_date;
  v_season_end := v_competition.end_date;

  SELECT lc.slot_minutes INTO v_lc_slot FROM league_config lc WHERE lc.league_id = v_league_id;

  IF EXISTS (SELECT 1 FROM fixtures WHERE competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'fixtures_already_exist' USING ERRCODE = 'P0001';
  END IF;

  IF p_fixtures IS NULL OR jsonb_typeof(p_fixtures) <> 'array' THEN
    RAISE EXCEPTION 'fixtures_required' USING ERRCODE = 'P0001';
  END IF;
  v_fixture_count := jsonb_array_length(p_fixtures);
  IF v_fixture_count = 0 THEN
    RAISE EXCEPTION 'fixtures_empty' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(team_id) INTO v_active_team_ids
  FROM competition_teams
  WHERE competition_id = p_competition_id AND status = 'active';

  IF v_active_team_ids IS NULL OR array_length(v_active_team_ids, 1) < 2 THEN
    RAISE EXCEPTION 'competition_has_too_few_active_teams' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(id) INTO v_venue_pitch_ids
  FROM playing_areas
  WHERE venue_id = v_venue_id;

  FOR v_fx IN SELECT * FROM jsonb_array_elements(p_fixtures) LOOP
    v_home := v_fx->>'home_team_id';
    v_away := v_fx->>'away_team_id';

    IF v_home IS NULL OR NOT (v_home = ANY(v_active_team_ids)) THEN
      RAISE EXCEPTION 'fixture_home_team_invalid' USING ERRCODE = 'P0001', DETAIL = v_home;
    END IF;
    IF v_away IS NOT NULL AND NOT (v_away = ANY(v_active_team_ids)) THEN
      RAISE EXCEPTION 'fixture_away_team_invalid' USING ERRCODE = 'P0001', DETAIL = v_away;
    END IF;

    IF (v_fx->>'scheduled_date') IS NOT NULL THEN
      v_date := (v_fx->>'scheduled_date')::date;
      IF v_date < v_season_start OR v_date > v_season_end THEN
        RAISE EXCEPTION 'fixture_date_outside_season' USING ERRCODE = 'P0001',
          DETAIL = v_fx->>'scheduled_date';
      END IF;
    END IF;

    IF (v_fx->>'playing_area_id') IS NOT NULL THEN
      v_pitch := (v_fx->>'playing_area_id')::uuid;
      IF v_venue_pitch_ids IS NULL OR NOT (v_pitch = ANY(v_venue_pitch_ids)) THEN
        RAISE EXCEPTION 'fixture_pitch_not_in_venue' USING ERRCODE = 'P0001',
          DETAIL = v_fx->>'playing_area_id';
      END IF;
    END IF;

    IF (v_fx->>'playing_area_id') IS NOT NULL
       AND (v_fx->>'scheduled_date') IS NOT NULL
       AND (v_fx->>'kickoff_time') IS NOT NULL THEN
      v_kickoff_text := v_fx->>'kickoff_time';
      IF length(v_kickoff_text) = 5 THEN v_kickoff_text := v_kickoff_text || ':00'; END IF;
      v_start := ((v_fx->>'scheduled_date')::date + v_kickoff_text::time) AT TIME ZONE 'Europe/London';
      v_range := tstzrange(v_start, v_start + make_interval(mins => COALESCE(v_lc_slot, 60)), '[)');
      v_clash_ids := v_clash_ids || COALESCE((
        SELECT array_agg(b.id)
        FROM pitch_occupancy po JOIN pitch_bookings b ON b.id = po.source_id::uuid
        WHERE po.playing_area_id = (v_fx->>'playing_area_id')::uuid
          AND po.active AND po.source_kind = 'booking'
          AND b.status = 'confirmed' AND po.time_range && v_range
      ), '{}'::uuid[]);
    END IF;
  END LOOP;

  IF array_length(v_clash_ids, 1) > 0 THEN
    SELECT array_agg(DISTINCT x) INTO v_undisplaced
    FROM unnest(v_clash_ids) x
    WHERE NOT (x = ANY(COALESCE(p_displace_booking_ids, '{}'::uuid[])));
    IF v_undisplaced IS NOT NULL AND array_length(v_undisplaced, 1) > 0 THEN
      RAISE EXCEPTION 'confirmed_booking_clash' USING ERRCODE = 'P0001',
        DETAIL = array_to_string(v_undisplaced, ',');
    END IF;
    FOR v_b IN SELECT DISTINCT b.id, b.team_id, b.venue_id FROM pitch_bookings b WHERE b.id = ANY(v_clash_ids) LOOP
      UPDATE pitch_occupancy SET active = false WHERE source_kind='booking' AND source_id = v_b.id::text;
      UPDATE pitch_bookings  SET status = 'superseded' WHERE id = v_b.id;
      PERFORM public.notify_venue_change(v_b.venue_id, 'booking_superseded');
      IF v_b.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_b.team_id, 'booking_superseded'); END IF;
    END LOOP;
  END IF;

  BEGIN
    FOR v_fx IN SELECT * FROM jsonb_array_elements(p_fixtures) LOOP
      v_home := v_fx->>'home_team_id';
      v_away := v_fx->>'away_team_id';
      v_date := NULLIF(v_fx->>'scheduled_date', '')::date;
      v_kickoff_text := v_fx->>'kickoff_time';
      IF v_kickoff_text IS NOT NULL AND length(v_kickoff_text) = 5 THEN
        v_kickoff_text := v_kickoff_text || ':00';
      END IF;
      v_kickoff := NULLIF(v_kickoff_text, '')::time;
      v_pitch := NULLIF(v_fx->>'playing_area_id', '')::uuid;

      INSERT INTO fixtures (
        competition_id, home_team_id, away_team_id,
        week_number, round_name,
        scheduled_date, kickoff_time,
        playing_area_id, status
      )
      VALUES (
        p_competition_id, v_home, v_away,
        (v_fx->>'week_number')::int, NULLIF(v_fx->>'round_name', ''),
        v_date, v_kickoff,
        v_pitch, 'scheduled'
      );
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'pitch_double_booked' USING ERRCODE = 'P0001';
  END;

  -- V2: auto-create per-team fixture charges when a fee is configured
  INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  SELECT v_venue_id, 'fixture', f.id::text, tm.team_id, f.competition_id,
         lc.fixture_fee_pence, 'unpaid', f.scheduled_date
  FROM fixtures f
  JOIN league_config lc ON lc.league_id = v_league_id
  CROSS JOIN LATERAL (
    SELECT f.home_team_id AS team_id
    UNION ALL
    SELECT f.away_team_id WHERE COALESCE(lc.fixture_fee_payer, 'both') = 'both'
  ) tm
  WHERE f.competition_id = p_competition_id
    AND tm.team_id IS NOT NULL
    AND COALESCE(lc.fixture_fee_pence, 0) > 0
  ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'fixtures_generated', 'venue', v_venue_id,
    jsonb_build_object(
      'competition_id', p_competition_id,
      'season_id', v_season_id,
      'league_id', v_league_id,
      'fixture_count', v_fixture_count,
      'displaced_booking_ids', p_displace_booking_ids
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'fixtures_generated');
  PERFORM public.notify_league_change(v_league_id, 'fixtures_generated');

  RETURN jsonb_build_object(
    'ok', true,
    'competition_id', p_competition_id,
    'fixture_count', v_fixture_count
  );
END;
$function$;

-- ── HOOK 3: venue_update_fixture_status (+ void → refund charges) ──────────────
CREATE OR REPLACE FUNCTION public.venue_update_fixture_status(p_venue_token text, p_fixture_id uuid, p_new_status text, p_metadata jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_fixture record;
  v_league_id text;
  v_winner text;
  v_reason text;
  v_broadcast_reason text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_status NOT IN ('postponed','void','walkover','forfeit') THEN
    RAISE EXCEPTION 'status_not_supported_by_this_rpc' USING ERRCODE = 'P0001',
      DETAIL = p_new_status;
  END IF;

  SELECT f.id, f.status, f.competition_id, f.home_team_id, f.away_team_id,
         s.league_id, l.venue_id AS l_venue
  INTO v_fixture
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE f.id = p_fixture_id;

  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.l_venue <> v_venue_id THEN
    RAISE EXCEPTION 'fixture_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_fixture.league_id;

  IF p_new_status = 'postponed' THEN
    IF v_fixture.status NOT IN ('scheduled','allocated') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001',
        DETAIL = v_fixture.status || '->postponed';
    END IF;
    v_reason := COALESCE(NULLIF(trim(p_metadata->>'postpone_reason'), ''), NULL);
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'postpone_reason_required' USING ERRCODE = 'P0001';
    END IF;
    UPDATE fixtures
       SET status = 'postponed',
           postpone_reason = v_reason
     WHERE id = p_fixture_id;
    v_broadcast_reason := 'fixture_postponed';

  ELSIF p_new_status = 'void' THEN
    IF v_fixture.status NOT IN ('scheduled','allocated','postponed') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001',
        DETAIL = v_fixture.status || '->void';
    END IF;
    v_reason := COALESCE(NULLIF(trim(p_metadata->>'void_reason'), ''), NULL);
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'void_reason_required' USING ERRCODE = 'P0001';
    END IF;
    UPDATE fixtures
       SET status = 'void',
           void_reason = v_reason
     WHERE id = p_fixture_id;
    v_broadcast_reason := 'fixture_voided';

    -- V2: a voided fixture is no longer collectible — cancel its charges (payments untouched)
    UPDATE venue_charges SET status = 'refunded'
     WHERE source_type = 'fixture' AND source_id = p_fixture_id::text AND status <> 'refunded';

  ELSIF p_new_status = 'walkover' THEN
    IF v_fixture.status NOT IN ('scheduled','allocated') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001',
        DETAIL = v_fixture.status || '->walkover';
    END IF;
    v_winner := NULLIF(trim(p_metadata->>'winner_team_id'), '');
    IF v_winner IS NULL THEN
      RAISE EXCEPTION 'winner_team_id_required' USING ERRCODE = 'P0001';
    END IF;
    IF v_winner <> v_fixture.home_team_id
       AND (v_fixture.away_team_id IS NULL OR v_winner <> v_fixture.away_team_id) THEN
      RAISE EXCEPTION 'winner_not_in_fixture' USING ERRCODE = 'P0001',
        DETAIL = v_winner;
    END IF;
    UPDATE fixtures
       SET status = 'walkover',
           walkover_winner_id = v_winner
     WHERE id = p_fixture_id;
    v_broadcast_reason := 'fixture_walkover';

  ELSIF p_new_status = 'forfeit' THEN
    IF v_fixture.status NOT IN ('scheduled','allocated','completed') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001',
        DETAIL = v_fixture.status || '->forfeit';
    END IF;
    v_winner := NULLIF(trim(p_metadata->>'winner_team_id'), '');
    IF v_winner IS NULL THEN
      RAISE EXCEPTION 'winner_team_id_required' USING ERRCODE = 'P0001';
    END IF;
    IF v_winner <> v_fixture.home_team_id
       AND (v_fixture.away_team_id IS NULL OR v_winner <> v_fixture.away_team_id) THEN
      RAISE EXCEPTION 'winner_not_in_fixture' USING ERRCODE = 'P0001',
        DETAIL = v_winner;
    END IF;
    v_reason := COALESCE(NULLIF(trim(p_metadata->>'forfeit_reason'), ''), NULL);
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'forfeit_reason_required' USING ERRCODE = 'P0001';
    END IF;
    UPDATE fixtures
       SET status = 'forfeit',
           forfeit_winner_id = v_winner,
           forfeit_reason = v_reason
     WHERE id = p_fixture_id;
    v_broadcast_reason := 'fixture_forfeit';
  END IF;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    v_broadcast_reason, 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'competition_id', v_fixture.competition_id,
      'league_id', v_league_id,
      'previous_status', v_fixture.status,
      'new_status', p_new_status,
      'metadata', p_metadata
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, v_broadcast_reason);
  PERFORM public.notify_league_change(v_league_id, 'fixture_status_changed');

  RETURN jsonb_build_object(
    'ok', true,
    'fixture_id', p_fixture_id,
    'status', p_new_status
  );
END;
$function$;
