-- Migration 226 — venue_get_customer (Phase B Customers, detail view, venue-domain).
-- One booker's bookings at this venue (newest first) with per-booking charge
-- (paid from venue_payments) and, for UPCOMING team sessions, the live in/target
-- (counts only — same boundary as mig 225). Read-only; venue-token authed.
-- booker_key: 'team:<id>' or 'walkin:<lower(booked_by_name)>' (matches mig 223).

CREATE OR REPLACE FUNCTION public.venue_get_customer(p_venue_token text, p_booker_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_team_id text;
  v_walkin  text;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  IF p_booker_key IS NULL THEN RAISE EXCEPTION 'bad_booker' USING ERRCODE = 'P0001'; END IF;
  IF left(p_booker_key, 5) = 'team:' THEN v_team_id := substr(p_booker_key, 6);
  ELSIF left(p_booker_key, 7) = 'walkin:' THEN v_walkin := substr(p_booker_key, 8);
  ELSE RAISE EXCEPTION 'bad_booker' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'booking_id',       b.id,
    'booking_date',     b.booking_date,
    'kickoff_time',     b.kickoff_time,
    'pitch_name',       pa.name,
    'status',           b.status,
    'kind',             b.kind,
    'series_id',        b.series_id,
    'amount_due_pence', ch.amount_due_pence,
    'paid_pence',       ch.paid,
    'in_count',  CASE WHEN v_team_id IS NOT NULL AND b.booking_date >= current_date THEN ic.in_count END,
    'target',    CASE WHEN v_team_id IS NOT NULL AND b.booking_date >= current_date THEN sc.squad_size END
  ) ORDER BY b.booking_date DESC, b.kickoff_time DESC), '[]'::jsonb) INTO v_rows
  FROM pitch_bookings b
  LEFT JOIN playing_areas pa ON pa.id = b.playing_area_id
  LEFT JOIN LATERAL (
    SELECT c.amount_due_pence,
           COALESCE((SELECT SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_pence ELSE p.amount_pence END)
                     FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid
    FROM venue_charges c WHERE c.source_type = 'booking' AND c.source_id = b.id::text LIMIT 1
  ) ch ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS in_count FROM players p JOIN team_players tp ON tp.player_id = p.id
    WHERE tp.team_id = b.team_id AND p.status = 'in' AND NOT p.disabled
  ) ic ON (v_team_id IS NOT NULL)
  LEFT JOIN LATERAL (
    SELECT s.squad_size FROM schedule s WHERE s.team_id = b.team_id AND s.active = true LIMIT 1
  ) sc ON (v_team_id IS NOT NULL)
  WHERE b.venue_id = v_caller.venue_id
    AND b.status <> 'superseded'
    AND ( (v_team_id IS NOT NULL AND b.team_id = v_team_id)
       OR (v_walkin IS NOT NULL AND lower(btrim(b.booked_by_name)) = v_walkin) );

  RETURN jsonb_build_object('bookings', v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_get_customer(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_get_customer(text, text) TO anon, authenticated;
