-- Migration 222 — Booking cancellation detail + policy-driven refund.
-- Phase B (venue-domain). Extends cancel_booking to record the operator's
-- cancellation REASON, NOTE and refund DECISION, and to act on the booking's
-- venue_charges row accordingly — mirroring the fixture-void refund path
-- already in mig 181:
--     full    -> charge status = 'refunded'  (drops out of owed/collected)
--     partial -> amount_due halved + status recomputed (half still charged)
--     none / NULL -> charge left untouched (full amount still owed)
-- The richer detail is written into the EXISTING audit_events row that
-- cancel_booking already emits — no new table. The cancellations log reads it
-- back via venue_list_cancellations (below), joining pitch detail.
-- within_policy is computed client-side (booking time vs venues.cancellation_policy);
-- the server only records it.
--
-- Param-type/arity change: PostgreSQL treats the new arg list as a distinct
-- overload, so the old 2-arg signature is DROPped first (CLAUDE.md RPC PARAMETER
-- TYPE CHANGES). The casual team-admin path (p_booking_id only) and the venue
-- path (p_venue_token) both still resolve via named params + defaults.
-- cancel_booking_series is unchanged this migration (no per-booking refund
-- decision on a whole-series cancel yet — tracked as a follow-up).

DROP FUNCTION IF EXISTS public.cancel_booking(uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id    uuid,
  p_venue_token   text DEFAULT NULL,
  p_reason        text DEFAULT NULL,
  p_note          text DEFAULT NULL,
  p_decision      text DEFAULT NULL,        -- 'full' | 'partial' | 'none' | NULL
  p_within_policy boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bk record;
  v_caller record;
  v_uid uuid := auth.uid();
  v_actor_type text;
  v_actor_ident text;
  v_charge record;
  v_refund_pence int := 0;
  v_charged_pence int := 0;
  v_decision text := lower(coalesce(p_decision, ''));
BEGIN
  SELECT * INTO v_bk FROM pitch_bookings WHERE id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001'; END IF;

  -- Dual auth: venue operator (token) OR the booking team's admin (auth.uid()).
  IF p_venue_token IS NOT NULL THEN
    SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
    IF v_caller IS NULL OR v_caller.venue_id IS NULL OR v_caller.venue_id <> v_bk.venue_id THEN
      RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
    END IF;
    v_actor_type := v_caller.actor_type; v_actor_ident := v_caller.actor_ident;
  ELSE
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
    IF v_bk.team_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = v_bk.team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0001';
    END IF;
    v_actor_type := 'team_admin'; v_actor_ident := 'user_id:' || v_uid::text;
  END IF;

  IF v_bk.status NOT IN ('requested','confirmed') THEN
    RAISE EXCEPTION 'booking_not_cancellable' USING ERRCODE = 'P0001', DETAIL = v_bk.status;
  END IF;

  UPDATE pitch_bookings SET status = 'cancelled' WHERE id = p_booking_id;
  UPDATE pitch_occupancy SET active = false WHERE source_kind = 'booking' AND source_id = p_booking_id::text;

  -- Refund decision -> the booking's charge (one charge per booking; skip if
  -- already refunded). Refund/charged pence captured for the audit + log.
  SELECT * INTO v_charge FROM venue_charges
   WHERE source_type = 'booking' AND source_id = p_booking_id::text AND status <> 'refunded'
   ORDER BY created_at LIMIT 1;
  IF v_charge.id IS NOT NULL THEN
    IF v_decision = 'full' THEN
      UPDATE venue_charges SET status = 'refunded' WHERE id = v_charge.id;
      v_refund_pence := v_charge.amount_due_pence; v_charged_pence := 0;
    ELSIF v_decision = 'partial' THEN
      v_charged_pence := v_charge.amount_due_pence / 2;
      v_refund_pence := v_charge.amount_due_pence - v_charged_pence;
      UPDATE venue_charges SET amount_due_pence = v_charged_pence WHERE id = v_charge.id;
      PERFORM public._recompute_charge_status(v_charge.id);
    ELSE
      v_charged_pence := v_charge.amount_due_pence; v_refund_pence := 0;
    END IF;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_bk.venue_id), v_uid, v_actor_type, v_actor_ident, 'booking_cancelled', 'pitch_booking', p_booking_id::text,
    jsonb_build_object(
      'venue_id', v_bk.venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id,
      'by', CASE WHEN p_venue_token IS NOT NULL THEN 'venue' ELSE 'team' END,
      'reason', p_reason, 'note', p_note,
      'decision', NULLIF(v_decision, ''), 'within_policy', p_within_policy,
      'refund_pence', v_refund_pence, 'charged_pence', v_charged_pence,
      'booking_date', v_bk.booking_date, 'kickoff_time', v_bk.kickoff_time,
      'playing_area_id', v_bk.playing_area_id, 'team_id', v_bk.team_id,
      'booked_by_name', v_bk.booked_by_name));

  PERFORM public.notify_venue_change(v_bk.venue_id, 'booking_cancelled');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_cancelled'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'cancelled',
                            'refund_pence', v_refund_pence, 'charged_pence', v_charged_pence);
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text, text, text, boolean) TO anon, authenticated;


-- Cancellations audit log for the venue dashboard. Reads back the
-- 'booking_cancelled' audit rows for this venue, newest first, joining live
-- pitch/team detail. Rows cancelled before mig 222 simply have null detail.
CREATE OR REPLACE FUNCTION public.venue_list_cancellations(
  p_venue_token text,
  p_limit       int DEFAULT 200
)
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

  SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', ae.id,
      'cancelled_at', ae.created_at,
      'entity_type', ae.entity_type,
      'booking_id', ae.entity_id,
      'team_id', ae.metadata->>'team_id',
      'team_name', t.name,
      'booked_by_name', ae.metadata->>'booked_by_name',
      'pitch_name', pa.name,
      'booking_date', ae.metadata->>'booking_date',
      'kickoff_time', ae.metadata->>'kickoff_time',
      'kind', ae.metadata->>'kind',
      'series_id', ae.metadata->>'series_id',
      'reason', ae.metadata->>'reason',
      'note', ae.metadata->>'note',
      'decision', ae.metadata->>'decision',
      'within_policy', (ae.metadata->>'within_policy')::boolean,
      'refund_pence', COALESCE(NULLIF(ae.metadata->>'refund_pence','')::int, 0),
      'charged_pence', COALESCE(NULLIF(ae.metadata->>'charged_pence','')::int, 0),
      'by', ae.metadata->>'by'
    ) AS r
    FROM audit_events ae
    LEFT JOIN teams t ON t.id = ae.metadata->>'team_id'
    LEFT JOIN playing_areas pa ON pa.id = NULLIF(ae.metadata->>'playing_area_id','')::uuid
    WHERE ae.action = 'booking_cancelled'
      AND ae.metadata->>'venue_id' = v_caller.venue_id
    ORDER BY ae.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 1000))
  ) sub;

  RETURN jsonb_build_object('cancellations', v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_list_cancellations(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_cancellations(text, int) TO anon, authenticated;
