-- Migration 223 — venue_list_customers (Phase B Customers, venue-domain only).
-- A "customer" = a booker at THIS venue: a registered team (grouped by team_id)
-- or a walk-in (grouped by booked_by_name). Aggregated purely from venue-side
-- tables (pitch_bookings + venue_charges) — NO casual-team data (players/ins/
-- team_admins) is read, per the venue<->casual RLS boundary. nudge_status is a
-- recency tier, not an ins metric. Read-only; venue-token authed.
--
--   bookings_count   real booking events (excludes superseded/declined/expired/hold)
--   total_paid_pence collected against this booker's bookings
--   outstanding_pence still owed (non-refunded balances)
--   nudge_status     new | healthy | lapsing | dormant  (from booking recency)

CREATE OR REPLACE FUNCTION public.venue_list_customers(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  WITH bk AS (
    SELECT
      COALESCE('team:' || b.team_id, 'walkin:' || lower(btrim(b.booked_by_name))) AS booker_key,
      b.team_id, b.booked_by_name, b.id AS booking_id, b.status, b.booking_date, b.created_at
    FROM pitch_bookings b
    WHERE b.venue_id = v_caller.venue_id
      AND b.status NOT IN ('superseded','declined','expired','hold')
      AND (b.team_id IS NOT NULL OR b.booked_by_name IS NOT NULL)
  ),
  chg AS (
    -- one charge per booking; paid = non-voided payments minus refunds.
    SELECT c.source_id,
           COALESCE(pp.paid, 0) AS paid,
           CASE WHEN c.status <> 'refunded'
                THEN GREATEST(c.amount_due_pence - COALESCE(pp.paid, 0), 0) ELSE 0 END AS outstanding
    FROM venue_charges c
    LEFT JOIN LATERAL (
      SELECT SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_pence ELSE p.amount_pence END) AS paid
      FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL
    ) pp ON true
    WHERE c.venue_id = v_caller.venue_id AND c.source_type = 'booking'
  ),
  agg AS (
    SELECT
      bk.booker_key,
      MAX(bk.team_id) AS team_id,
      MAX(bk.booked_by_name) AS booked_by_name,
      COUNT(*) AS bookings_count,
      COUNT(*) FILTER (WHERE bk.status = 'confirmed') AS confirmed_count,
      MIN(bk.created_at) AS first_at,
      MAX(bk.created_at) AS last_at,
      MAX(bk.booking_date) AS last_play_date,
      COALESCE(SUM(ch.paid), 0) AS total_paid,
      COALESCE(SUM(ch.outstanding), 0) AS total_outstanding
    FROM bk LEFT JOIN chg ch ON ch.source_id = bk.booking_id::text
    GROUP BY bk.booker_key
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'booker_key',        a.booker_key,
    'is_team',           a.team_id IS NOT NULL,
    'team_id',           a.team_id,
    'name',              COALESCE(t.name, a.booked_by_name, 'Walk-in'),
    'primary_colour',    t.primary_colour,
    'secondary_colour',  t.secondary_colour,
    'bookings_count',    a.bookings_count,
    'confirmed_count',   a.confirmed_count,
    'total_paid_pence',  a.total_paid,
    'outstanding_pence', a.total_outstanding,
    'first_at',          a.first_at,
    'last_at',           a.last_at,
    'nudge_status', CASE
      WHEN a.bookings_count <= 2 AND a.first_at > now() - interval '21 days' THEN 'new'
      WHEN GREATEST(a.last_at, a.last_play_date::timestamptz) < now() - interval '60 days' THEN 'dormant'
      WHEN GREATEST(a.last_at, a.last_play_date::timestamptz) < now() - interval '30 days' THEN 'lapsing'
      ELSE 'healthy' END
  ) ORDER BY a.last_at DESC), '[]'::jsonb) INTO v_rows
  FROM agg a LEFT JOIN teams t ON t.id = a.team_id;

  RETURN jsonb_build_object('customers', v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_list_customers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_customers(text) TO anon, authenticated;
