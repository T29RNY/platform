-- 550 DOWN: remove the pay-intent write RPC + the intent/reminder fields from venue_get_charges
-- + the two additive columns. Restore the pre-550 venue_get_charges body verbatim.

DROP FUNCTION IF EXISTS public.member_flag_charge_pay_intent(uuid, text);

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
           c.amount_due_pence, c.status, c.due_date, c.created_at, c.billing_run_id,
           br.label AS run_label,
           pn.payer_name,
           COALESCE((SELECT SUM(CASE WHEN p.kind='payment' THEN p.amount_pence ELSE -p.amount_pence END)
                     FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid_pence
    FROM venue_charges c
    LEFT JOIN venue_billing_runs br ON br.id = c.billing_run_id
    LEFT JOIN LATERAL (
      SELECT NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') AS payer_name
      FROM public.member_profiles mp
      WHERE mp.id = CASE c.source_type
        WHEN 'membership'    THEN (SELECT vm.member_profile_id FROM public.venue_memberships vm             WHERE vm.id::text = split_part(c.source_id, ':', 1))
        WHEN 'class'         THEN (SELECT b.member_profile_id  FROM public.venue_class_bookings b           WHERE b.id::text  = c.source_id)
        WHEN 'pt'            THEN (SELECT a.member_profile_id  FROM public.venue_appointments a             WHERE a.id::text  = c.source_id)
        WHEN 'class_package' THEN (SELECT bl.member_profile_id FROM public.venue_member_package_balances bl WHERE bl.id::text = c.source_id)
        WHEN 'room_hire'     THEN (SELECT h.member_profile_id  FROM public.venue_room_hires h              WHERE h.id::text  = c.source_id)
        ELSE NULL
      END
    ) pn ON true
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
        'billing_run_id', billing_run_id, 'run_label', run_label,
        'payer_name', payer_name) ORDER BY due_date DESC NULLS LAST, created_at DESC)
      FROM (SELECT * FROM ch ORDER BY due_date DESC NULLS LAST, created_at DESC LIMIT GREATEST(p_limit, 0)) lim
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

ALTER TABLE public.venue_charges DROP COLUMN IF EXISTS pay_intent_method;
ALTER TABLE public.venue_charges DROP COLUMN IF EXISTS pay_intent_at;
