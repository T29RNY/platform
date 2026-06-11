-- Migration 259 — Equipment Hire V1 returns/deposits RPCs. Cycle 3 of EQUIPMENT_HIRE_PLAN.md.
-- Builds on mig 258 schema. Same venue pattern (resolve_venue_caller, SECDEF, audited).
--
--   venue_create_equipment_hire(...)   — REPLACED: now snapshots the catalogue deposit
--                                         onto the hire (held). Signature unchanged.
--   venue_mark_equipment_out(token,hire)        — confirmed → out (+ handed_out_at).
--   venue_mark_equipment_returned(token,hire,condition?,forfeit_deposit?)
--                                       — confirmed/out → returned (+ returned_at, release
--                                         or forfeit the deposit, write condition back to asset).
--   venue_list_equipment_hires(...)    — REPLACED: adds deposit_*, handed_out_at,
--                                         returned_condition, derived `is_overdue`, and a
--                                         board `summary` (out_now / overdue / due_today).
--                                         Return-shape change → EquipmentView updated same commit.

-- ── venue_create_equipment_hire (REPLACE: + deposit snapshot) ─────────────────
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
        v_hire_id uuid; v_fee int; v_charge_id uuid; v_deposit int; v_dep_status text;
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

  SELECT * INTO v_eq FROM equipment WHERE id = p_equipment_id FOR UPDATE;
  IF v_eq.id IS NULL THEN RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_eq.venue_id <> v_venue_id THEN RAISE EXCEPTION 'equipment_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF NOT v_eq.active THEN RAISE EXCEPTION 'equipment_inactive' USING ERRCODE = 'P0001'; END IF;

  v_peak := public._equipment_peak_committed(p_equipment_id, p_start_at, p_end_at);
  v_free := v_eq.quantity - v_peak;
  IF p_qty > v_free THEN
    INSERT INTO equipment_demand_misses (venue_id, category, equipment_id, window_start, window_end, qty_wanted, source)
    VALUES (v_venue_id, v_eq.category, p_equipment_id, p_start_at, p_end_at, p_qty, 'venue');
    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'equipment_demand_miss', 'equipment', p_equipment_id::text,
            jsonb_build_object('venue_id', v_venue_id, 'category', v_eq.category, 'wanted', p_qty, 'free', GREATEST(v_free,0)));
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_quantity', 'free', GREATEST(v_free,0), 'wanted', p_qty);
  END IF;

  -- deposit snapshot: a refundable hold, tracked on the hire row (not the ledger)
  v_deposit := COALESCE(v_eq.deposit_pence, 0);
  v_dep_status := CASE WHEN v_deposit > 0 THEN 'held' ELSE 'none' END;

  INSERT INTO equipment_bookings (equipment_id, venue_id, team_id, booked_by_name, qty,
                                  start_at, end_at, due_back_at, booking_id, fixture_id,
                                  status, amount_pence, contact_email, contact_phone,
                                  deposit_pence, deposit_status)
  VALUES (p_equipment_id, v_venue_id, p_team_id, NULLIF(trim(COALESCE(p_booked_by_name,'')),''), p_qty,
          p_start_at, p_end_at, p_due_back_at, p_booking_id, p_fixture_id,
          'confirmed', COALESCE(p_amount_pence, v_eq.default_fee_pence),
          NULLIF(p_contact_email,''), NULLIF(p_contact_phone,''),
          v_deposit, v_dep_status)
  RETURNING id INTO v_hire_id;

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
                             'fee_pence', v_fee, 'deposit_pence', v_deposit, 'booking_id', p_booking_id, 'fixture_id', p_fixture_id));

  RETURN jsonb_build_object('ok', true, 'hire_id', v_hire_id, 'charge_id', v_charge_id,
    'fee_pence', v_fee, 'deposit_pence', v_deposit, 'free_after', GREATEST(v_free - p_qty, 0));
END;
$function$;

-- ── venue_mark_equipment_out (write) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_mark_equipment_out(p_venue_token text, p_hire_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_hire record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_hire FROM equipment_bookings WHERE id = p_hire_id;
  IF v_hire.id IS NULL THEN RAISE EXCEPTION 'hire_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.venue_id <> v_venue_id THEN RAISE EXCEPTION 'hire_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.status = 'out' THEN RETURN jsonb_build_object('ok', true, 'already', true, 'status', 'out'); END IF;
  IF v_hire.status <> 'confirmed' THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001', DETAIL = v_hire.status || '->out'; END IF;

  UPDATE equipment_bookings SET status = 'out', handed_out_at = now() WHERE id = p_hire_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_hire.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'equipment_handed_out', 'equipment_booking', p_hire_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'equipment_id', v_hire.equipment_id, 'qty', v_hire.qty));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'status', 'out');
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_mark_equipment_out(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_mark_equipment_out(text, uuid) TO anon, authenticated;

-- ── venue_mark_equipment_returned (write) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_mark_equipment_returned(
  p_venue_token text, p_hire_id uuid, p_condition text DEFAULT NULL, p_forfeit_deposit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_hire record; v_new_dep text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;

  IF p_condition IS NOT NULL AND p_condition NOT IN ('new','good','worn','damaged','retired') THEN
    RAISE EXCEPTION 'invalid_condition' USING ERRCODE = 'P0001', DETAIL = p_condition; END IF;

  SELECT * INTO v_hire FROM equipment_bookings WHERE id = p_hire_id;
  IF v_hire.id IS NULL THEN RAISE EXCEPTION 'hire_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.venue_id <> v_venue_id THEN RAISE EXCEPTION 'hire_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.status NOT IN ('confirmed','out') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001', DETAIL = v_hire.status || '->returned'; END IF;

  v_new_dep := CASE WHEN v_hire.deposit_status = 'held'
                    THEN (CASE WHEN p_forfeit_deposit THEN 'forfeited' ELSE 'released' END)
                    ELSE v_hire.deposit_status END;

  UPDATE equipment_bookings SET
    status = 'returned', returned_at = now(), returned_condition = p_condition,
    deposit_status = v_new_dep,
    deposit_resolved_at = CASE WHEN v_hire.deposit_status = 'held' THEN now() ELSE deposit_resolved_at END
  WHERE id = p_hire_id;

  -- write the returned condition back to the catalogue item (asset condition tracking)
  IF p_condition IS NOT NULL THEN
    UPDATE equipment SET condition = p_condition, updated_at = now() WHERE id = v_hire.equipment_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_hire.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'equipment_returned', 'equipment_booking', p_hire_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'equipment_id', v_hire.equipment_id,
                             'condition', p_condition, 'deposit_status', v_new_dep, 'deposit_pence', v_hire.deposit_pence));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'status', 'returned', 'deposit_status', v_new_dep);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_mark_equipment_returned(text, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_mark_equipment_returned(text, uuid, text, boolean) TO anon, authenticated;

-- ── venue_list_equipment_hires (REPLACE: + deposit/return/overdue + board) ────
CREATE OR REPLACE FUNCTION public.venue_list_equipment_hires(
  p_venue_token text, p_status text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_rows jsonb; v_summary jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;

  -- board summary across ALL of this venue's hires (independent of the row filter)
  SELECT jsonb_build_object(
    'out_now',   count(*) FILTER (WHERE status = 'out'),
    'overdue',   count(*) FILTER (WHERE status IN ('confirmed','out') AND due_back_at IS NOT NULL AND due_back_at < now() AND returned_at IS NULL),
    'due_today', count(*) FILTER (WHERE status IN ('confirmed','out') AND returned_at IS NULL AND due_back_at::date = current_date)
  ) INTO v_summary
  FROM equipment_bookings WHERE venue_id = v_venue_id;

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'start_at') DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', b.id, 'equipment_id', b.equipment_id, 'equipment_name', e.name, 'category', e.category,
      'team_id', b.team_id, 'booked_by_name', b.booked_by_name, 'qty', b.qty,
      'start_at', b.start_at, 'end_at', b.end_at, 'due_back_at', b.due_back_at,
      'handed_out_at', b.handed_out_at, 'returned_at', b.returned_at, 'returned_condition', b.returned_condition,
      'booking_id', b.booking_id, 'fixture_id', b.fixture_id, 'status', b.status, 'amount_pence', b.amount_pence,
      'deposit_pence', b.deposit_pence, 'deposit_status', b.deposit_status,
      'is_overdue', (b.status IN ('confirmed','out') AND b.due_back_at IS NOT NULL AND b.due_back_at < now() AND b.returned_at IS NULL),
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

  RETURN jsonb_build_object('hires', v_rows, 'summary', v_summary);
END;
$function$;
