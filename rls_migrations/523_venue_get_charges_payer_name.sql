-- 523_venue_get_charges_payer_name.sql
-- Add `payer_name` to each charge returned by venue_get_charges so the operator
-- Payments ledger (mobile OperatorPayments + laptop PaymentsView) can show WHO a
-- membership / class / PT / class-package / room-hire charge is for — not just team
-- charges (which already carry a team name). ADDITIVE return-shape change: adds one
-- field, existing fields unchanged (safe for every consumer; they ignore it until
-- read). CREATE OR REPLACE of the existing SECURITY DEFINER read, SAME signature
-- (no overload / DROP needed). Auth + grants identical to mig 405.
--
-- The name is resolved from the charge's source_id per source_type → member_profiles
-- (the exact join member_profiles uses in mig 405's _bulk_cohort_memberships /
-- get_my_money). Team / fixture / booking charges get NULL payer_name and keep their
-- existing team-name / run-label / source label in the UI (client falls back).
--
-- PII note: the Payments tab is owner|manager-only (nav.js tabsFor — plain staff have
-- no Payments tab), and payer_name is a first+last NAME only (not special-category),
-- so this does not widen the plain-staff PII surface (cf. GO_LIVE_ISSUES —
-- venue_list_customers_people). No new grant.

CREATE OR REPLACE FUNCTION public.venue_get_charges(
  p_venue_token text, p_status text DEFAULT NULL, p_source_type text DEFAULT NULL, p_limit int DEFAULT 200)
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
      -- Resolve the member_profile behind this charge (per source_type) → a display name.
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
REVOKE ALL ON FUNCTION public.venue_get_charges(text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_get_charges(text, text, text, int) TO anon, authenticated;
SELECT pg_notify('pgrst', 'reload schema');
