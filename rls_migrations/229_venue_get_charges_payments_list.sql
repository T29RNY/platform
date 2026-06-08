-- Migration 229: add per-charge payments[] to venue_get_charges
--
-- The venue Payments screen could record payments but had no way to UNDO a single
-- mis-recorded one — only void the whole charge (which also wipes what's owed).
-- venue_void_payment exists but the UI had no payment IDs to act on, because
-- venue_get_charges returned only the net paid_pence. Add an active-payments array
-- (voided_at IS NULL) per charge so the screen can list each payment and undo it.
--
-- Purely additive — single consumer (apps/venue PaymentsView). Read-only RPC,
-- grants preserved by CREATE OR REPLACE. Summary maths unchanged. The payment
-- timestamp column is venue_payments.taken_at (not created_at).

CREATE OR REPLACE FUNCTION public.venue_get_charges(p_venue_token text, p_status text DEFAULT NULL::text, p_source_type text DEFAULT NULL::text, p_limit integer DEFAULT 200)
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

  WITH ch AS (
    SELECT c.id, c.source_type, c.source_id, c.team_id, c.competition_id,
           c.amount_due_pence, c.status, c.due_date, c.created_at,
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
