-- Migration 257 — Equipment Hire V1 hire flow. Cycle 2 of EQUIPMENT_HIRE_PLAN.md.
-- The one cycle with genuinely new logic: QUANTITY-AWARE availability (a pitch is
-- 1-of-1; a venue may own 4 goal sets). Builds on mig 255/256.
--
--   _equipment_peak_committed(eq, from, to)   — internal: peak concurrent committed
--                                                qty in [from,to). The availability primitive.
--   get_equipment_availability(token,from,to,cat?) — read: per-item free units in a window.
--   venue_create_equipment_hire(...)          — write: pre-confirmed hire + auto-charge +
--                                                row-locked quantity guard. On insufficient
--                                                stock RETURNS ok:false AND logs an
--                                                equipment_demand_misses row (a RAISE would
--                                                roll the miss back — the turn-away is the signal).
--   venue_cancel_equipment_hire(token,hire)   — write: cancel a hire + refund its charge.
--   venue_list_equipment_hires(token,...)      — read: hires + booker + charge state.
--
-- Pattern per mig 181: resolve_venue_caller, SECDEF + pinned search_path, audited.
-- venue_confirm/decline_equipment_hire deferred until a REQUEST channel exists
-- (Cycle 4 self-serve) — Cycle 2 venue hires are created pre-confirmed.

-- ── peak-concurrent primitive ─────────────────────────────────────────────────
-- The only instants where concurrency can rise are the window start and each
-- committed hire's start within the window; sum active qty at each, take the max.
CREATE OR REPLACE FUNCTION public._equipment_peak_committed(
  p_equipment_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS int
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH bounds AS (
    SELECT p_start AS t
    UNION
    SELECT b.start_at FROM equipment_bookings b
    WHERE b.equipment_id = p_equipment_id
      AND b.status IN ('confirmed','out')
      AND b.start_at < p_end AND b.end_at > p_start
      AND b.start_at >= p_start AND b.start_at < p_end
  )
  SELECT COALESCE(MAX(concurrent), 0)::int FROM (
    SELECT (SELECT COALESCE(SUM(b.qty), 0) FROM equipment_bookings b
             WHERE b.equipment_id = p_equipment_id
               AND b.status IN ('confirmed','out')
               AND b.start_at <= bounds.t AND b.end_at > bounds.t) AS concurrent
    FROM bounds
  ) s;
$function$;
REVOKE ALL ON FUNCTION public._equipment_peak_committed(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- ── get_equipment_availability (read) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_equipment_availability(
  p_venue_token text, p_from timestamptz, p_to timestamptz, p_category text DEFAULT NULL)
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
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'equipment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'category', e.category, 'quantity', e.quantity,
        'free', GREATEST(e.quantity - public._equipment_peak_committed(e.id, p_from, p_to), 0),
        'default_fee_pence', e.default_fee_pence, 'deposit_pence', e.deposit_pence,
        'hire_unit', e.hire_unit, 'condition', e.condition)
        ORDER BY e.category, e.name)
      FROM equipment e
      WHERE e.venue_id = v_venue_id AND e.active
        AND (p_category IS NULL OR e.category = p_category)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_equipment_availability(text, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_equipment_availability(text, timestamptz, timestamptz, text) TO anon, authenticated;

-- ── venue_create_equipment_hire (write) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_equipment_hire(
  p_venue_token    text,
  p_equipment_id   uuid,
  p_qty            int,
  p_start_at       timestamptz,
  p_end_at         timestamptz,
  p_team_id        text        DEFAULT NULL,
  p_booked_by_name text        DEFAULT NULL,
  p_due_back_at    timestamptz DEFAULT NULL,
  p_booking_id     uuid        DEFAULT NULL,
  p_fixture_id     uuid        DEFAULT NULL,
  p_contact_email  text        DEFAULT NULL,
  p_contact_phone  text        DEFAULT NULL,
  p_amount_pence   int         DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_eq record; v_peak int; v_free int;
        v_hire_id uuid; v_fee int; v_charge_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0001'; END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NULL AND NULLIF(trim(COALESCE(p_booked_by_name,'')),'') IS NULL THEN
    RAISE EXCEPTION 'booker_required' USING ERRCODE = 'P0001'; END IF;

  -- row-lock the catalogue item so concurrent hires serialize on the quantity guard
  SELECT * INTO v_eq FROM equipment WHERE id = p_equipment_id FOR UPDATE;
  IF v_eq.id IS NULL THEN RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_eq.venue_id <> v_venue_id THEN RAISE EXCEPTION 'equipment_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF NOT v_eq.active THEN RAISE EXCEPTION 'equipment_inactive' USING ERRCODE = 'P0001'; END IF;

  v_peak := public._equipment_peak_committed(p_equipment_id, p_start_at, p_end_at);
  v_free := v_eq.quantity - v_peak;
  IF p_qty > v_free THEN
    -- genuine turn-away: persist the demand signal, then soft-fail (a RAISE here
    -- would roll the miss back). Cycle 2's only demand-miss source.
    INSERT INTO equipment_demand_misses (venue_id, category, equipment_id, window_start, window_end, qty_wanted, source)
    VALUES (v_venue_id, v_eq.category, p_equipment_id, p_start_at, p_end_at, p_qty, 'venue');
    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'equipment_demand_miss', 'equipment', p_equipment_id::text,
            jsonb_build_object('venue_id', v_venue_id, 'category', v_eq.category, 'wanted', p_qty, 'free', GREATEST(v_free,0)));
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_quantity', 'free', GREATEST(v_free,0), 'wanted', p_qty);
  END IF;

  INSERT INTO equipment_bookings (equipment_id, venue_id, team_id, booked_by_name, qty,
                                  start_at, end_at, due_back_at, booking_id, fixture_id,
                                  status, amount_pence, contact_email, contact_phone)
  VALUES (p_equipment_id, v_venue_id, p_team_id, NULLIF(trim(COALESCE(p_booked_by_name,'')),''), p_qty,
          p_start_at, p_end_at, p_due_back_at, p_booking_id, p_fixture_id,
          'confirmed', COALESCE(p_amount_pence, v_eq.default_fee_pence),
          NULLIF(p_contact_email,''), NULLIF(p_contact_phone,''))
  RETURNING id INTO v_hire_id;

  -- auto-charge the hire fee through the shared ledger (skip when zero)
  v_fee := COALESCE(NULLIF(p_amount_pence, 0), v_eq.default_fee_pence, 0);
  IF v_fee > 0 THEN
    INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_venue_id, 'equipment', v_hire_id::text, p_team_id, NULL, v_fee, 'unpaid', p_start_at::date)
    ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING
    RETURNING id INTO v_charge_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(p_team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'equipment_hired', 'equipment_booking', v_hire_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'equipment_id', p_equipment_id, 'qty', p_qty,
                             'fee_pence', v_fee, 'booking_id', p_booking_id, 'fixture_id', p_fixture_id));

  RETURN jsonb_build_object('ok', true, 'hire_id', v_hire_id, 'charge_id', v_charge_id,
    'fee_pence', v_fee, 'free_after', GREATEST(v_free - p_qty, 0));
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_create_equipment_hire(text, uuid, int, timestamptz, timestamptz, text, text, timestamptz, uuid, uuid, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_equipment_hire(text, uuid, int, timestamptz, timestamptz, text, text, timestamptz, uuid, uuid, text, text, int) TO anon, authenticated;

-- ── venue_cancel_equipment_hire (write) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_cancel_equipment_hire(p_venue_token text, p_hire_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_hire record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_hire FROM equipment_bookings WHERE id = p_hire_id;
  IF v_hire.id IS NULL THEN RAISE EXCEPTION 'hire_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.venue_id <> v_venue_id THEN RAISE EXCEPTION 'hire_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.status IN ('cancelled','declined','returned') THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'status', v_hire.status);
  END IF;

  UPDATE equipment_bookings SET status = 'cancelled' WHERE id = p_hire_id;
  -- refund (void) its charge: drops from owed/collected, payments kept
  UPDATE venue_charges SET status = 'refunded'
    WHERE source_type = 'equipment' AND source_id = p_hire_id::text AND status <> 'refunded';

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_hire.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'equipment_hire_cancelled', 'equipment_booking', p_hire_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'equipment_id', v_hire.equipment_id, 'prev_status', v_hire.status));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'status', 'cancelled');
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_cancel_equipment_hire(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_equipment_hire(text, uuid) TO anon, authenticated;

-- ── venue_list_equipment_hires (read) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_equipment_hires(
  p_venue_token text, p_status text DEFAULT NULL, p_limit int DEFAULT 200)
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

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'start_at') DESC), '[]'::jsonb) INTO v_result FROM (
    SELECT jsonb_build_object(
      'id', b.id, 'equipment_id', b.equipment_id, 'equipment_name', e.name, 'category', e.category,
      'team_id', b.team_id, 'booked_by_name', b.booked_by_name, 'qty', b.qty,
      'start_at', b.start_at, 'end_at', b.end_at, 'due_back_at', b.due_back_at, 'returned_at', b.returned_at,
      'booking_id', b.booking_id, 'fixture_id', b.fixture_id, 'status', b.status, 'amount_pence', b.amount_pence,
      'charge_status', c.status, 'amount_due_pence', c.amount_due_pence,
      'paid_pence', COALESCE((SELECT SUM(CASE WHEN p.kind='payment' THEN p.amount_pence ELSE -p.amount_pence END)
                              FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0)
    ) AS row
    FROM equipment_bookings b
    JOIN equipment e ON e.id = b.equipment_id
    LEFT JOIN venue_charges c ON c.source_type='equipment' AND c.source_id = b.id::text
    WHERE b.venue_id = v_venue_id
      AND (p_status IS NULL OR b.status = p_status)
    ORDER BY b.start_at DESC
    LIMIT GREATEST(p_limit, 0)
  ) s;

  RETURN jsonb_build_object('hires', v_result);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_list_equipment_hires(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_equipment_hires(text, text, int) TO anon, authenticated;
