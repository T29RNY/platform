-- Migration 233 — surface payment + first-time onto the schedule grid.
--
-- The venue ScheduleGrid colours blocks by booking TYPE today; the operator wants
-- colour = PAYMENT (green = paid/nothing owed, amber = money owed) and a word tag for
-- type (One-off / Block / League) + a NEW badge for a customer's first-ever booking.
-- Type fields already reach the frontend (source_kind + detail.kind + series_id). This
-- adds the two missing signals to get_pitch_occupancy's detail:
--   • owed     — is there an outstanding balance on this source's charge(s)? (booking + fixture)
--   • is_first — is this the booker's first-ever booking at the venue? (bookings only)
--
-- Read-only RPC (no audit/notify/write) — ephemeral-verify not mandated; rpc-security +
-- live shape check apply. Rebuilt on the LIVE body (series_id already present, preserved).

-- ── helper: does a charge source have an outstanding balance? ──────────────────
-- True when any non-refunded charge for (source_type, source_id) is owed money
-- (amount_due > sum of non-voided payments). Mirrors the ledger math in venue_get_charges.
CREATE OR REPLACE FUNCTION public._venue_source_owed(p_source_type text, p_source_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM venue_charges c
    WHERE c.source_type = p_source_type
      AND c.source_id = p_source_id
      AND c.status <> 'refunded'
      AND c.amount_due_pence > COALESCE((
        SELECT SUM(CASE WHEN p.kind = 'payment' THEN p.amount_pence ELSE -p.amount_pence END)
        FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0)
  );
$function$;
REVOKE ALL ON FUNCTION public._venue_source_owed(text, text) FROM PUBLIC;

-- ── get_pitch_occupancy (rebuild: + owed, + is_first) ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_pitch_occupancy(p_venue_token text, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_range    tstzrange;
  v_result   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'date_range_required' USING ERRCODE = 'P0001';
  END IF;

  v_range := tstzrange(
    (p_from::timestamp) AT TIME ZONE 'Europe/London',
    ((p_to + 1)::timestamp) AT TIME ZONE 'Europe/London', '[)');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', po.id,
    'playing_area_id', po.playing_area_id,
    'pitch_name', pa.name,
    'source_kind', po.source_kind,
    'source_id', po.source_id,
    'priority', po.priority,
    'start', lower(po.time_range),
    'end',   upper(po.time_range),
    'detail', CASE po.source_kind
      WHEN 'fixture' THEN (
        SELECT jsonb_build_object('home_team', th.name, 'away_team', ta.name, 'status', f.status,
          'owed', public._venue_source_owed('fixture', po.source_id))
        FROM fixtures f
        LEFT JOIN teams th ON th.id = f.home_team_id
        LEFT JOIN teams ta ON ta.id = f.away_team_id
        WHERE f.id = po.source_id::uuid)
      WHEN 'booking' THEN (
        SELECT jsonb_build_object(
          'team_id', b.team_id,
          'team_name', COALESCE(tb.name, b.booked_by_name),
          'kind', b.kind, 'status', b.status, 'series_id', b.series_id,
          'owed', public._venue_source_owed('booking', po.source_id),
          'is_first', NOT EXISTS (
            SELECT 1 FROM pitch_bookings b2
            WHERE b2.venue_id = b.venue_id AND b2.id <> b.id AND b2.created_at < b.created_at
              AND ( (b.team_id IS NOT NULL AND b2.team_id = b.team_id)
                 OR (b.team_id IS NULL AND b.booked_by_name IS NOT NULL
                     AND lower(b2.booked_by_name) = lower(b.booked_by_name)) )))
        FROM pitch_bookings b
        LEFT JOIN teams tb ON tb.id = b.team_id
        WHERE b.id = po.source_id::uuid)
      ELSE jsonb_build_object('reason', 'maintenance')
    END
  ) ORDER BY lower(po.time_range), pa.name), '[]'::jsonb)
  INTO v_result
  FROM pitch_occupancy po
  JOIN playing_areas pa ON pa.id = po.playing_area_id
  WHERE po.venue_id = v_venue_id AND po.active AND po.time_range && v_range;

  RETURN v_result;
END;
$function$;
