-- 281_booking_discount_label.sql
--
-- Surface the member booking discount on the Payments ledger. The discounted
-- amount was already stored (mig 277); this records the APPLIED `member_discount_pct`
-- on the booking at confirm time (immutable record, independent of later tier
-- changes) and returns it on booking charges via venue_get_charges so the venue
-- can see "20% member discount applied" on the row.
-- Confirm bodies are byte-identical to mig 277 except for one persist line each.

ALTER TABLE public.pitch_bookings
  ADD COLUMN IF NOT EXISTS member_discount_pct int;

CREATE OR REPLACE FUNCTION public.venue_confirm_booking(p_venue_token text, p_booking_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_bk record;
  v_fee int;
  v_base int;
  v_cust uuid;
  v_pct int;
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

  SELECT COALESCE(NULLIF(v_bk.amount_pence, 0), pa.default_fee_pence) INTO v_fee
  FROM playing_areas pa WHERE pa.id = v_bk.playing_area_id;

  SELECT d.customer_id, d.pct INTO v_cust, v_pct
  FROM public._booking_member_discount(v_venue_id, v_bk.customer_id, v_bk.contact_email) d;
  IF v_cust IS NOT NULL AND v_bk.customer_id IS NULL THEN
    UPDATE pitch_bookings SET customer_id = v_cust WHERE id = p_booking_id;
  END IF;
  UPDATE pitch_bookings SET member_discount_pct = NULLIF(COALESCE(v_pct,0), 0) WHERE id = p_booking_id;

  v_base := v_fee;
  IF v_fee IS NOT NULL AND v_fee > 0 AND COALESCE(v_pct,0) > 0 THEN
    v_fee := v_fee - round(v_fee * v_pct / 100.0)::int;
  END IF;

  IF v_fee IS NOT NULL AND v_fee > 0 THEN
    INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_venue_id, 'booking', p_booking_id::text, v_bk.team_id, NULL, v_fee, 'unpaid', v_bk.booking_date)
    ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'pitch_booking', p_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id,
                       'base_fee_pence', v_base, 'member_discount_pct', COALESCE(v_pct,0),
                       'member_customer_id', v_cust, 'charge_fee_pence', v_fee));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_confirmed'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'confirmed',
                            'member_discount_pct', COALESCE(v_pct,0), 'charge_fee_pence', v_fee);
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_confirm_booking_series(p_venue_token text, p_series_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_series    record;
  v_bk        record;
  v_fee       int;
  v_base      int;
  v_cust      uuid;
  v_pct       int;
  v_confirmed int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT * INTO v_series FROM booking_series WHERE id = p_series_id;
  IF v_series.id IS NULL THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_series.venue_id <> v_venue_id THEN RAISE EXCEPTION 'booking_not_in_venue' USING ERRCODE = 'P0001'; END IF;

  FOR v_bk IN
    SELECT * FROM pitch_bookings
     WHERE series_id = p_series_id AND venue_id = v_venue_id AND status = 'requested'
     ORDER BY booking_date
  LOOP
    UPDATE pitch_bookings SET status = 'confirmed' WHERE id = v_bk.id;

    SELECT COALESCE(NULLIF(v_bk.amount_pence, 0), pa.default_fee_pence) INTO v_fee
    FROM playing_areas pa WHERE pa.id = v_bk.playing_area_id;

    SELECT d.customer_id, d.pct INTO v_cust, v_pct
    FROM public._booking_member_discount(v_venue_id, v_bk.customer_id, v_bk.contact_email) d;
    IF v_cust IS NOT NULL AND v_bk.customer_id IS NULL THEN
      UPDATE pitch_bookings SET customer_id = v_cust WHERE id = v_bk.id;
    END IF;
    UPDATE pitch_bookings SET member_discount_pct = NULLIF(COALESCE(v_pct,0), 0) WHERE id = v_bk.id;

    v_base := v_fee;
    IF v_fee IS NOT NULL AND v_fee > 0 AND COALESCE(v_pct,0) > 0 THEN
      v_fee := v_fee - round(v_fee * v_pct / 100.0)::int;
    END IF;

    IF v_fee IS NOT NULL AND v_fee > 0 THEN
      INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
      VALUES (v_venue_id, 'booking', v_bk.id::text, v_bk.team_id, NULL, v_fee, 'unpaid', v_bk.booking_date)
      ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;
    END IF;

    v_confirmed := v_confirmed + 1;
  END LOOP;

  IF v_confirmed = 0 THEN RAISE EXCEPTION 'booking_not_pending' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_series.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'booking_series', p_series_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'series_id', p_series_id, 'confirmed_count', v_confirmed));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF v_series.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_series.team_id, 'booking_confirmed'); END IF;

  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id, 'confirmed_count', v_confirmed, 'status', 'confirmed');
END;
$function$;

-- venue_get_charges — booking charges gain member_discount_pct (NULL for others).
CREATE OR REPLACE FUNCTION public.venue_get_charges(p_venue_token text, p_status text DEFAULT NULL::text, p_source_type text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
           (SELECT b.member_discount_pct FROM pitch_bookings b
             WHERE c.source_type='booking' AND b.id::text = c.source_id) AS member_discount_pct,
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
        'member_discount_pct', member_discount_pct,
        'paid_pence', paid_pence, 'balance_pence', GREATEST(amount_due_pence - paid_pence, 0),
        'status', status, 'due_date', due_date,
        'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'kind', p.kind, 'amount_pence', p.amount_pence,
            'method', p.method, 'note', p.note, 'taken_at', p.taken_at)
            ORDER BY p.taken_at)
          FROM venue_payments p WHERE p.charge_id = lim.id AND p.voided_at IS NULL), '[]'::jsonb)
        ) ORDER BY due_date DESC NULLS LAST, created_at DESC)
      FROM (SELECT * FROM ch ORDER BY due_date DESC NULLS LAST, created_at DESC LIMIT GREATEST(p_limit, 0)) lim
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
