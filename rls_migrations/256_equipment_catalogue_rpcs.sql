-- Migration 256 — Equipment Hire V1 catalogue RPCs. Cycle 1 of EQUIPMENT_HIRE_PLAN.md.
-- Builds on mig 255 schema. Mirrors the venue write-RPC pattern from mig 181:
--   resolve_venue_caller auth, SECDEF + pinned search_path, audit_events
--   (team_id NOT NULL → use venue_id), REVOKE ALL / GRANT anon+authenticated.
--
--   venue_list_equipment(token)        — read: catalogue + per-item live counts + summary.
--   venue_upsert_equipment(...)        — write: create (p_id NULL) or edit a catalogue item.
--
-- No notify_venue_change here: catalogue edits are single-operator and the
-- EquipmentView re-fetches its own list after a write (CustomersView-style
-- isolation), so there is no realtime subscriber to mismatch (Hard Rule #10 N/A).
-- The per-item hires_count / out_now columns are returned NOW (all-zero in
-- Cycle 1) so the Cycle 2 hire flow adds rows without a return-shape change
-- (Hard Rule #12/#14).

-- ── venue_list_equipment (read) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_list_equipment(p_venue_token text)
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

  WITH eq AS (
    SELECT e.*,
      COALESCE((SELECT count(*) FROM equipment_bookings b
                 WHERE b.equipment_id = e.id
                   AND b.status IN ('confirmed','out','returned','overdue')), 0) AS hires_count,
      COALESCE((SELECT count(*) FROM equipment_bookings b
                 WHERE b.equipment_id = e.id AND b.status = 'out'), 0) AS out_now
    FROM equipment e
    WHERE e.venue_id = v_venue_id
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'item_count',        (SELECT count(*) FROM eq),
      'active_count',      (SELECT count(*) FROM eq WHERE active),
      'total_units',       COALESCE((SELECT SUM(quantity) FROM eq WHERE active), 0),
      'asset_value_pence', COALESCE((SELECT SUM(COALESCE(purchase_price_pence,0)) FROM eq), 0)
    ),
    'equipment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'category', category, 'quantity', quantity,
        'default_fee_pence', default_fee_pence, 'deposit_pence', deposit_pence,
        'hire_unit', hire_unit, 'purchase_price_pence', purchase_price_pence,
        'acquired_on', acquired_on, 'condition', condition, 'active', active,
        'hires_count', hires_count, 'out_now', out_now, 'created_at', created_at)
        ORDER BY active DESC, category, name)
      FROM eq), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_list_equipment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_equipment(text) TO anon, authenticated;

-- ── venue_upsert_equipment (write: create or edit) ────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_upsert_equipment(
  p_venue_token        text,
  p_name               text,
  p_category           text,
  p_quantity           int,
  p_id                 uuid    DEFAULT NULL,
  p_default_fee_pence  int     DEFAULT 0,
  p_deposit_pence      int     DEFAULT 0,
  p_hire_unit          text    DEFAULT 'per_session',
  p_purchase_price_pence int   DEFAULT NULL,
  p_acquired_on        date    DEFAULT NULL,
  p_condition          text    DEFAULT 'good',
  p_active             boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_existing record; v_row record; v_is_new boolean;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001'; END IF;
  IF p_category NOT IN ('apparel','balls','goals_targets','nets','training_aids','tech_av','safety') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'P0001', DETAIL = p_category; END IF;
  IF p_hire_unit NOT IN ('per_hour','per_session','per_day') THEN
    RAISE EXCEPTION 'invalid_hire_unit' USING ERRCODE = 'P0001', DETAIL = p_hire_unit; END IF;
  IF p_condition NOT IN ('new','good','worn','damaged','retired') THEN
    RAISE EXCEPTION 'invalid_condition' USING ERRCODE = 'P0001', DETAIL = p_condition; END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(p_default_fee_pence,0) < 0 OR COALESCE(p_deposit_pence,0) < 0
     OR COALESCE(p_purchase_price_pence,0) < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001'; END IF;

  v_is_new := p_id IS NULL;

  IF v_is_new THEN
    INSERT INTO equipment (venue_id, name, category, quantity, default_fee_pence, deposit_pence,
                           hire_unit, purchase_price_pence, acquired_on, condition, active)
    VALUES (v_venue_id, trim(p_name), p_category, p_quantity, COALESCE(p_default_fee_pence,0),
            COALESCE(p_deposit_pence,0), p_hire_unit, p_purchase_price_pence, p_acquired_on,
            p_condition, COALESCE(p_active,true))
    RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_existing FROM equipment WHERE id = p_id;
    IF v_existing.id IS NULL THEN RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = 'P0001'; END IF;
    IF v_existing.venue_id <> v_venue_id THEN RAISE EXCEPTION 'equipment_not_in_venue' USING ERRCODE = 'P0001'; END IF;
    UPDATE equipment SET
      name = trim(p_name), category = p_category, quantity = p_quantity,
      default_fee_pence = COALESCE(p_default_fee_pence,0), deposit_pence = COALESCE(p_deposit_pence,0),
      hire_unit = p_hire_unit, purchase_price_pence = p_purchase_price_pence,
      acquired_on = p_acquired_on, condition = p_condition, active = COALESCE(p_active,true),
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          CASE WHEN v_is_new THEN 'equipment_created' ELSE 'equipment_updated' END,
          'equipment', v_row.id::text,
          jsonb_build_object('venue_id', v_venue_id, 'name', v_row.name, 'category', v_row.category,
                             'quantity', v_row.quantity, 'active', v_row.active));

  RETURN jsonb_build_object('ok', true, 'is_new', v_is_new,
    'equipment', jsonb_build_object(
      'id', v_row.id, 'name', v_row.name, 'category', v_row.category, 'quantity', v_row.quantity,
      'default_fee_pence', v_row.default_fee_pence, 'deposit_pence', v_row.deposit_pence,
      'hire_unit', v_row.hire_unit, 'purchase_price_pence', v_row.purchase_price_pence,
      'acquired_on', v_row.acquired_on, 'condition', v_row.condition, 'active', v_row.active,
      'hires_count', 0, 'out_now', 0, 'created_at', v_row.created_at));
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_upsert_equipment(text, text, text, int, uuid, int, int, text, int, date, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_upsert_equipment(text, text, text, int, uuid, int, int, text, int, date, text, boolean) TO anon, authenticated;
