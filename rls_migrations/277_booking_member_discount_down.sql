-- 277_booking_member_discount_down.sql — reverse of 277_booking_member_discount.sql
-- Restores venue_confirm_booking + venue_confirm_booking_series to their pre-277
-- bodies, drops the discount helper, and drops the link column.

CREATE OR REPLACE FUNCTION public.venue_confirm_booking(p_venue_token text, p_booking_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION public.venue_confirm_booking_series(p_venue_token text, p_series_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_series    record;
  v_bk        record;
  v_fee       int;
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

DROP FUNCTION IF EXISTS public._booking_member_discount(text,uuid,text);
DROP INDEX IF EXISTS public.pitch_bookings_customer_idx;
ALTER TABLE public.pitch_bookings DROP COLUMN IF EXISTS customer_id;
