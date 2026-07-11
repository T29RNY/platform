-- 550: (D4) cash/bank pay-intent signal to the operator + (D5) reminder-sent visibility.
--
-- D4 — when a family taps "Pay cash at the club" / "Bank transfer" in BookPaySheet the place
-- is held but nothing is recorded, so the operator has no signal they INTEND to pay by that
-- method. Add two additive nullable columns on venue_charges + a small member-scoped RPC that
-- stamps them; surface them in venue_get_charges so the operator sees a "says cash/bank" pill.
--   • venue_charges.pay_intent_method  ('cash' | 'bank_transfer'), NULL until flagged
--   • venue_charges.pay_intent_at      timestamptz
--   • member_flag_charge_pay_intent(charge_id, method) — auth.uid, caller must OWN the charge
--     (member OR membership payer OR accepted guardian of the member); status must be open.
--
-- D5 — payment reminders (migs 540/541) write notification_log (RLS-walled, staff-invisible).
-- Add read-only reminder aggregates to venue_get_charges via a LATERAL over notification_log,
-- joined charge↔log by split_part(entity_id,':',1) (legacy rows carry a bare charge id; post-540
-- rows carry '<charge>:<stage>'). No new write, no RLS change.
--
-- Consumers (Hard Rule #14): apps/inorout BookPaySheet.jsx (write) + OperatorPayments.jsx;
-- apps/venue PaymentsView.jsx (both pills/columns read venue_get_charges).

ALTER TABLE public.venue_charges
  ADD COLUMN IF NOT EXISTS pay_intent_method text
    CHECK (pay_intent_method IS NULL OR pay_intent_method IN ('cash','bank_transfer')),
  ADD COLUMN IF NOT EXISTS pay_intent_at timestamptz;

-- ── D4 write RPC: member flags their own charge's pay-intent ──
CREATE OR REPLACE FUNCTION public.member_flag_charge_pay_intent(p_charge_id uuid, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_charge  record;
  v_member  uuid;
  v_ok      boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001'; END IF;
  IF p_method NOT IN ('cash','bank_transfer') THEN RAISE EXCEPTION 'invalid_method' USING ERRCODE = 'P0001'; END IF;

  SELECT id, source_type, source_id, status, venue_id INTO v_charge
    FROM public.venue_charges WHERE id = p_charge_id;
  IF v_charge.id IS NULL THEN RAISE EXCEPTION 'charge_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_charge.status NOT IN ('unpaid','partial') THEN RAISE EXCEPTION 'charge_not_open' USING ERRCODE = 'P0001'; END IF;

  -- Resolve the charge's member (membership + class covered — the sources BookPaySheet opens for).
  v_member := CASE v_charge.source_type
    WHEN 'membership' THEN (SELECT vm.member_profile_id FROM public.venue_memberships vm WHERE vm.id::text = split_part(v_charge.source_id, ':', 1))
    WHEN 'class'      THEN (SELECT b.member_profile_id  FROM public.venue_class_bookings b WHERE b.id::text  = v_charge.source_id)
    ELSE NULL END;

  -- Authorise: caller is the member, OR the membership payer, OR an accepted guardian of the member.
  IF v_member = v_profile THEN
    v_ok := true;
  ELSIF v_charge.source_type = 'membership' AND EXISTS (
    SELECT 1 FROM public.venue_memberships vm
    WHERE vm.id::text = split_part(v_charge.source_id, ':', 1) AND vm.payer_profile_id = v_profile
  ) THEN
    v_ok := true;
  ELSIF v_member IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.member_guardians mg
    WHERE mg.guardian_profile_id = v_profile AND mg.child_profile_id = v_member AND mg.invite_state = 'accepted'
  ) THEN
    v_ok := true;
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.venue_charges SET pay_intent_method = p_method, pay_intent_at = now() WHERE id = p_charge_id;

  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_charge.venue_id, v_uid, 'player', 'charge_pay_intent_flagged', 'venue_charge', p_charge_id::text,
          jsonb_build_object('method', p_method, 'member_profile_id', v_member));

  RETURN jsonb_build_object('ok', true, 'charge_id', p_charge_id, 'pay_intent_method', p_method);
END;
$function$;

REVOKE ALL ON FUNCTION public.member_flag_charge_pay_intent(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_flag_charge_pay_intent(uuid, text) TO authenticated;

-- ── D4 + D5 reader: venue_get_charges gains pay-intent + reminder aggregates ──
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
           c.pay_intent_method, c.pay_intent_at,
           br.label AS run_label,
           pn.payer_name,
           rem.last_reminded_at, rem.reminder_count, rem.last_reminder_stage,
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
    LEFT JOIN LATERAL (
      SELECT max(nl.sent_at) AS last_reminded_at,
             count(*)::int   AS reminder_count,
             (array_agg(NULLIF(split_part(nl.entity_id, ':', 2), '') ORDER BY nl.sent_at DESC))[1] AS last_reminder_stage
      FROM public.notification_log nl
      WHERE nl.type LIKE 'membership\_%' AND nl.channel = 'email' AND nl.sent_at IS NOT NULL
        AND split_part(nl.entity_id, ':', 1) = c.id::text
    ) rem ON true
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
        'payer_name', payer_name,
        'pay_intent_method', pay_intent_method, 'pay_intent_at', pay_intent_at,
        'last_reminded_at', last_reminded_at, 'reminder_count', COALESCE(reminder_count, 0), 'last_reminder_stage', last_reminder_stage
        ) ORDER BY due_date DESC NULLS LAST, created_at DESC)
      FROM (SELECT * FROM ch ORDER BY due_date DESC NULLS LAST, created_at DESC LIMIT GREATEST(p_limit, 0)) lim
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
