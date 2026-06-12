-- 277_booking_member_discount.sql
--
-- Phase 6 — booking discount auto-apply. Builds the missing booking↔member link
-- (`pitch_bookings.customer_id`) and applies a member's tier `discount_pct` to the
-- booking charge at confirmation time — in BOTH confirm paths (single + series).
--
-- CRITICAL BOOKING PATH. Behaviour is identical to before for non-members: same
-- status checks, same notify/audit, same charge unless a discount genuinely applies.
-- The member is resolved by the explicit link if set, else auto-matched by the
-- booking's contact email to an ACTIVE member of THIS venue (and the link is then
-- persisted). Only an `active` membership with a numeric `discount_pct` discounts;
-- a frozen/ending member, a non-member, or a missing/zero/garbage pct charges full.
-- 100%-off comps to no charge (no row), exactly as a zero fee does today.

-- 1. The link.
ALTER TABLE public.pitch_bookings
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.venue_customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pitch_bookings_customer_idx
  ON public.pitch_bookings (customer_id) WHERE customer_id IS NOT NULL;

-- 2. Discount resolver — explicit link first, else email-match an active venue member.
--    Returns the resolved customer + the clamped discount pct (0 if none).
CREATE OR REPLACE FUNCTION public._booking_member_discount(
  p_venue_id text, p_customer_id uuid, p_email text)
RETURNS TABLE(customer_id uuid, pct int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_cust uuid := p_customer_id;
  v_pct  int  := 0;
BEGIN
  IF v_cust IS NULL AND p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    SELECT c.id INTO v_cust
      FROM public.venue_customers c
     WHERE c.venue_id = p_venue_id AND lower(c.email) = lower(btrim(p_email))
       AND c.status = 'active'
     LIMIT 1;
  END IF;

  IF v_cust IS NOT NULL THEN
    SELECT COALESCE(LEAST(100, GREATEST(0,
             CASE WHEN t.benefits->>'discount_pct' ~ '^[0-9]+$'
                  THEN (t.benefits->>'discount_pct')::int ELSE 0 END)), 0)
      INTO v_pct
      FROM public.venue_memberships m
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
     WHERE m.customer_id = v_cust AND m.status = 'active'
     ORDER BY (CASE WHEN t.benefits->>'discount_pct' ~ '^[0-9]+$'
                    THEN (t.benefits->>'discount_pct')::int ELSE 0 END) DESC
     LIMIT 1;
  END IF;

  customer_id := v_cust;
  pct := COALESCE(v_pct, 0);
  RETURN NEXT;
END;
$fn$;
REVOKE ALL ON FUNCTION public._booking_member_discount(text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._booking_member_discount(text,uuid,text) TO service_role;

-- 3. venue_confirm_booking — same as before + member discount.
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

-- 4. venue_confirm_booking_series — same as before + member discount per booking.
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
