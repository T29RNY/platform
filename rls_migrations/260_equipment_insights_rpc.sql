-- Migration 260 — Equipment Hire data-product tail. Cycle 5 of EQUIPMENT_HIRE_PLAN.md.
-- The payoff for the Cycle-1 data foundations: turn the clean hire/asset/demand data
-- into venue-facing intelligence. READ-ONLY — no writes, no new charge paths, so no
-- ephemeral-verify (Hard Rule #15 N/A); rpc-security-sweep still gates the commit.
--
--   venue_equipment_insights(token, from?, to?) — three intelligence blocks:
--     roi[]         — per asset, LIFETIME: purchase cost vs revenue COLLECTED (net
--                     payments) + billed, payback %, payback_status, idle flag.
--     usage[]       — per asset, over [from,to] (default trailing 90d): hires, units
--                     out, unit-hours, busiest day-of-week, share of total hires.
--                     No fabricated "owned-hours" denominator — honest activity, not
--                     a guessed utilisation %.
--     procurement[] — from equipment_demand_misses over [from,to], grouped by category:
--                     turn-aways, units wanted, last miss, vs currently-owned qty.
--                     The recommendation SENTENCE is built client-side (kept out of SQL).
--
-- Revenue maths mirror venue_list_equipment_hires (mig 257): a hire's charge is
-- venue_charges where source_type='equipment' AND source_id = hire.id::text (one charge
-- per hire — the UNIQUE on (source_type,source_id,COALESCE(team_id,'')) guarantees it);
-- COLLECTED = SUM over its venue_payments of (payment − refund) where voided_at IS NULL,
-- counted regardless of charge status (cancelled hires keep their cash). BILLED =
-- amount_due on non-refunded charges.
--
-- "Hired" statuses (a real hire happened) = confirmed | out | returned | overdue.
-- requested/declined/cancelled are NOT hires. Matches venue_list_equipment's hires_count.
--
-- Designed as the future venue-Gaffer "what should I buy next?" context source
-- (Hard Rule #14 — recorded in RPCS.md Notes). Returns a single jsonb the edge
-- function can pass verbatim as <context>.
--
-- Security: SECDEF, search_path pinned, STABLE, resolve_venue_caller auth,
-- REVOKE ALL / GRANT anon+authenticated (mirrors venue_list_equipment).

CREATE OR REPLACE FUNCTION public.venue_equipment_insights(
  p_venue_token text,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text;
  v_from date; v_to date; v_days int;
  v_from_ts timestamptz; v_to_ts timestamptz;
  v_total_hires int;
  v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  v_from := COALESCE(p_from, current_date - 89);   -- trailing 90 days inclusive
  v_to   := COALESCE(p_to,   current_date);
  v_days := (v_to - v_from) + 1;
  -- half-open [from 00:00, to+1 00:00) local-day window for range filters
  v_from_ts := v_from::timestamp;
  v_to_ts   := (v_to + 1)::timestamp;

  -- ── per-asset lifetime revenue (collected = net payments; billed = non-refunded owed) ──
  -- one row per equipment item with its lifetime hire counts + revenue.
  WITH eq AS (
    SELECT e.id, e.name, e.category, e.quantity, e.condition, e.active,
           e.purchase_price_pence, e.acquired_on, e.default_fee_pence, e.deposit_pence
    FROM equipment e WHERE e.venue_id = v_venue_id
  ),
  hires AS (   -- every real hire (lifetime) with its window + linked charge id
    SELECT b.id, b.equipment_id, b.qty, b.start_at, b.end_at, b.status,
           c.id AS charge_id, c.amount_due_pence, c.status AS charge_status
    FROM equipment_bookings b
    LEFT JOIN venue_charges c
      ON c.source_type = 'equipment' AND c.source_id = b.id::text
    WHERE b.venue_id = v_venue_id
      AND b.status IN ('confirmed','out','returned','overdue')
  ),
  hire_rev AS (   -- collected per hire = net non-voided payments on its charge
    SELECT h.equipment_id, h.id AS hire_id, h.qty, h.start_at, h.end_at,
           CASE WHEN h.charge_status IS DISTINCT FROM 'refunded'
                THEN COALESCE(h.amount_due_pence,0) ELSE 0 END AS billed_pence,
           COALESCE((SELECT SUM(CASE WHEN p.kind='payment' THEN p.amount_pence ELSE -p.amount_pence END)
                     FROM venue_payments p
                     WHERE p.charge_id = h.charge_id AND p.voided_at IS NULL), 0) AS collected_pence
    FROM hires h
  ),
  asset_roll AS (   -- lifetime rollup per item
    SELECT e.id,
           COALESCE(SUM(hr.collected_pence), 0)::bigint AS collected_pence,
           COALESCE(SUM(hr.billed_pence),    0)::bigint AS billed_pence,
           COUNT(hr.hire_id)::int                       AS hires_count
    FROM eq e LEFT JOIN hire_rev hr ON hr.equipment_id = e.id
    GROUP BY e.id
  ),
  -- ── range usage per item ──
  range_usage AS (
    SELECT h.equipment_id,
           COUNT(*)::int                                                            AS hires_count,
           COALESCE(SUM(h.qty),0)::int                                              AS units_hired,
           ROUND(COALESCE(SUM(h.qty * EXTRACT(epoch FROM (h.end_at - h.start_at))/3600.0),0)::numeric, 1) AS unit_hours,
           MODE() WITHIN GROUP (ORDER BY EXTRACT(dow FROM h.start_at)::int)         AS busiest_dow,
           MAX(h.start_at)                                                          AS last_hired_at
    FROM hires h
    WHERE h.start_at >= v_from_ts AND h.start_at < v_to_ts
    GROUP BY h.equipment_id
  ),
  -- ── range demand misses by category ──
  misses AS (
    SELECT dm.category,
           COUNT(*)::int               AS miss_count,
           COALESCE(SUM(dm.qty_wanted),0)::int AS units_wanted,
           MAX(dm.created_at)          AS last_miss_at
    FROM equipment_demand_misses dm
    WHERE dm.venue_id = v_venue_id
      AND dm.created_at >= v_from_ts AND dm.created_at < v_to_ts
    GROUP BY dm.category
  ),
  owned_by_cat AS (
    SELECT category, SUM(quantity)::int AS owned_qty, COUNT(*)::int AS item_count
    FROM eq WHERE active GROUP BY category
  )
  SELECT
    (SELECT COALESCE(SUM(hires_count),0) FROM range_usage),
    jsonb_build_object(
      'range', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_days),
      'note',  'ROI is lifetime (cost is one-off); usage and procurement use the date range.',
      'summary', jsonb_build_object(
        'asset_cost_pence',       (SELECT COALESCE(SUM(COALESCE(purchase_price_pence,0)),0) FROM eq),
        'collected_lifetime_pence',(SELECT COALESCE(SUM(collected_pence),0) FROM asset_roll),
        'billed_lifetime_pence',  (SELECT COALESCE(SUM(billed_pence),0) FROM asset_roll),
        'overall_payback_pct',    (SELECT CASE WHEN SUM(COALESCE(e.purchase_price_pence,0)) > 0
                                     THEN ROUND(100.0 * (SELECT COALESCE(SUM(collected_pence),0) FROM asset_roll)
                                                / SUM(COALESCE(e.purchase_price_pence,0)), 0) ELSE NULL END FROM eq e),
        'idle_count',             (SELECT COUNT(*) FROM eq e JOIN asset_roll a ON a.id = e.id
                                     WHERE e.active AND a.hires_count = 0),
        'misses_in_range',        (SELECT COALESCE(SUM(miss_count),0) FROM misses),
        'units_wanted_in_range',  (SELECT COALESCE(SUM(units_wanted),0) FROM misses)
      ),
      -- ROI per asset (lifetime) — ordered worst-payback first so dead money surfaces top
      'roi', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'name', e.name, 'category', e.category, 'active', e.active,
          'condition', e.condition, 'quantity', e.quantity, 'acquired_on', e.acquired_on,
          'purchase_price_pence', e.purchase_price_pence,
          'collected_pence', a.collected_pence, 'billed_pence', a.billed_pence,
          'hires_count', a.hires_count,
          'payback_pct', CASE WHEN COALESCE(e.purchase_price_pence,0) > 0
                              THEN ROUND(100.0 * a.collected_pence / e.purchase_price_pence, 0) ELSE NULL END,
          'payback_status', CASE
            WHEN COALESCE(e.purchase_price_pence,0) = 0 THEN 'unknown'
            WHEN a.collected_pence >= e.purchase_price_pence THEN 'recouped'
            WHEN a.collected_pence > 0 THEN 'partial'
            ELSE 'not_started' END,
          'idle', (e.active AND a.hires_count = 0))
          ORDER BY
            CASE WHEN COALESCE(e.purchase_price_pence,0) > 0
                 THEN a.collected_pence::numeric / e.purchase_price_pence ELSE 999 END ASC,
            e.name)
        FROM eq e JOIN asset_roll a ON a.id = e.id), '[]'::jsonb),
      -- usage per asset over range — busiest items first
      'usage', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'name', e.name, 'category', e.category, 'quantity', e.quantity,
          'hires_count', COALESCE(u.hires_count,0),
          'units_hired', COALESCE(u.units_hired,0),
          'unit_hours',  COALESCE(u.unit_hours,0),
          'busiest_day', CASE u.busiest_dow
            WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed'
            WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat' ELSE NULL END,
          'last_hired_at', u.last_hired_at,
          'share_pct', CASE WHEN v_total_hires_inner.t > 0
                            THEN ROUND(100.0 * COALESCE(u.hires_count,0) / v_total_hires_inner.t, 0) ELSE 0 END)
          ORDER BY COALESCE(u.hires_count,0) DESC, e.name)
        FROM eq e
        LEFT JOIN range_usage u ON u.equipment_id = e.id
        CROSS JOIN (SELECT COALESCE(SUM(hires_count),0) AS t FROM range_usage) v_total_hires_inner
        WHERE e.active), '[]'::jsonb),
      -- procurement signal — most turned-away categories first
      'procurement', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'category', m.category,
          'miss_count', m.miss_count,
          'units_wanted', m.units_wanted,
          'last_miss_at', m.last_miss_at,
          'owned_qty', COALESCE(o.owned_qty, 0),
          'item_count', COALESCE(o.item_count, 0))
          ORDER BY m.miss_count DESC, m.units_wanted DESC)
        FROM misses m LEFT JOIN owned_by_cat o ON o.category = m.category), '[]'::jsonb)
    )
  INTO v_total_hires, v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_equipment_insights(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_equipment_insights(text, date, date) TO anon, authenticated;
