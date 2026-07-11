-- 555: (#1) NON-Stripe refund. Today the only refund path is Stripe:
-- venue_refund_charge_resolve sums ONLY method='stripe' payments + returns a stripe_charge_ref for
-- the Stripe API to process — so a cash/bank-paid charge shows £0 refundable and there is NO way to
-- record money handed back manually. `Void` is not a refund (it drops the charge from owed/collected
-- and KEEPS payments). This adds a manual refund recorder, the mirror of venue_record_payment.
--
-- venue_record_refund(venue_token, charge_id, amount_pence, method, note?):
--   • token-gated exactly like venue_record_payment (resolve_venue_caller + charge-in-venue); manual
--     methods only (cash|bank_transfer|other — Stripe refunds keep their own API path).
--   • refundable = net paid (Σ payments − Σ prior refunds, non-voided). PARTIAL allowed; amount must
--     be > 0 and <= refundable (else refund_exceeds_paid). Nothing paid → nothing_to_refund.
--   • inserts a venue_payments row kind='refund' (subtracts from net paid via the existing
--     Σ(payment)−Σ(refund) convention used by _recompute_charge_status + get_my_money).
--   • FULL refund (net paid → 0) sets the charge status to terminal 'refunded'; a PARTIAL refund
--     recomputes to 'partial'/'paid' on the remaining balance.
--   • audits 'refund_recorded' (HR#9) + notify_venue_change.
-- Consumers (HR#14): apps/venue PaymentsView (desktop Record-refund action). Reads that surface
-- refunds: get_my_money (guardian; class arm already excludes status='refunded'), venue_get_charges.

CREATE OR REPLACE FUNCTION public.venue_record_refund(
  p_venue_token text, p_charge_id uuid, p_amount_pence integer,
  p_method text, p_note text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_charge record;
  v_net_paid int; v_refundable int; v_payment_id uuid; v_new_status text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_amount_pence IS NULL OR p_amount_pence <= 0 THEN
    RAISE EXCEPTION 'amount_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_method NOT IN ('cash','bank_transfer','other') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = 'P0001', DETAIL = p_method;
  END IF;

  SELECT * INTO v_charge FROM venue_charges WHERE id = p_charge_id;
  IF v_charge.id IS NULL THEN RAISE EXCEPTION 'charge_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_charge.venue_id <> v_venue_id THEN RAISE EXCEPTION 'charge_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_charge.status = 'refunded' THEN RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'P0001'; END IF;

  -- Net paid across ALL non-voided payments minus prior refunds (same convention as
  -- _recompute_charge_status / get_my_money). This is what can be handed back.
  SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_pence ELSE -amount_pence END), 0)
    INTO v_net_paid FROM venue_payments WHERE charge_id = p_charge_id AND voided_at IS NULL;
  v_refundable := GREATEST(v_net_paid, 0);
  IF v_refundable <= 0 THEN RAISE EXCEPTION 'nothing_to_refund' USING ERRCODE = 'P0001'; END IF;
  IF p_amount_pence > v_refundable THEN
    RAISE EXCEPTION 'refund_exceeds_paid' USING ERRCODE = 'P0001', DETAIL = v_refundable::text;
  END IF;

  INSERT INTO venue_payments (charge_id, kind, amount_pence, method, note, taken_by)
  VALUES (p_charge_id, 'refund', p_amount_pence, p_method, NULLIF(p_note, ''), v_caller.actor_ident)
  RETURNING id INTO v_payment_id;

  -- Full refund → terminal 'refunded'; partial → recompute against the remaining balance.
  IF (v_refundable - p_amount_pence) <= 0 THEN
    UPDATE venue_charges SET status = 'refunded' WHERE id = p_charge_id;
  ELSE
    PERFORM public._recompute_charge_status(p_charge_id);
  END IF;
  SELECT status INTO v_new_status FROM venue_charges WHERE id = p_charge_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_charge.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'refund_recorded', 'venue_payment', v_payment_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'charge_id', p_charge_id,
                             'amount_pence', p_amount_pence, 'method', p_method));

  PERFORM public.notify_venue_change(v_venue_id, 'refund_recorded');

  RETURN jsonb_build_object('ok', true, 'payment_id', v_payment_id, 'charge_id', p_charge_id,
    'charge_status', v_new_status, 'refunded_pence', p_amount_pence);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_record_refund(text, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_record_refund(text, uuid, integer, text, text) TO anon, authenticated;
