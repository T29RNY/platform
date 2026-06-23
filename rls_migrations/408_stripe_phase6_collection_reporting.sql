-- 408 — Stripe Full Build PHASE 6: collection, chasing & reporting (scope #16, #6.2, #6.3).
--
-- Additive only. Every existing member is byte-identical until an operator sends a
-- reminder or opens the reconciliation view. Nothing assumes live Stripe keys.
--
-- #16 — Pay-now links: a charge can resolve a pay link two ways, in priority:
--   (1) its OWN Stripe hosted-invoice URL (minted by api/stripe-bulk-invoices.js for a
--       pay-online bulk run — previously thrown away; now persisted on the charge), or
--   (2) the venue's generic venues.payment_link (manual; operator reconciles).
--   New nullable column venue_charges.pay_url holds (1). New service_role-only write
--   stripe_set_charge_pay_url persists it from the invoicing API.
--
-- #6.2 — De-storm: a pay-online charge that has a Stripe hosted invoice is dunned by
--   Stripe itself (its own invoice + reminder emails). Our cron payment_due reminder
--   would be a pure duplicate, so get_membership_reminders_due now SUPPRESSES payment_due
--   rows whose charge has a pay_url. Cash/manual charges still chase, and carry
--   venues.payment_link as the email's pay link when set. The in-app pill (get_my_money)
--   is NOT an email, so it surfaces the real Stripe hosted-invoice link with no double-send.
--
-- #6.3 — Reconciliation: new READ-only venue_payment_reconciliation — per-period
--   raised/paid/outstanding/overdue + collection rate + Stripe-vs-manual by_method split.
--
-- Gotchas honoured: venue_* reads grant anon+authenticated (anon = venue-token backdoor,
-- auth enforced inside via resolve_venue_caller + _venue_has_cap); service_role write
-- REVOKEs anon+authenticated explicitly (Supabase auto-grants on new fns — mig-175 gotcha).

-- ── 1. pay_url column (additive nullable) ──────────────────────────────────────
ALTER TABLE public.venue_charges ADD COLUMN IF NOT EXISTS pay_url text;

-- ── 2. stripe_set_charge_pay_url (service_role write) — persist a charge's Stripe
-- hosted-invoice URL from api/stripe-bulk-invoices.js. Audited (Hard Rule #9 trace).
CREATE OR REPLACE FUNCTION public.stripe_set_charge_pay_url(p_charge_id uuid, p_pay_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_charge record;
BEGIN
  IF p_charge_id IS NULL THEN RAISE EXCEPTION 'missing_params' USING ERRCODE='P0001'; END IF;
  SELECT id, venue_id, team_id, pay_url INTO v_charge FROM public.venue_charges WHERE id = p_charge_id;
  IF v_charge.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'charge_not_found'); END IF;
  IF COALESCE(v_charge.pay_url,'') = COALESCE(p_pay_url,'') THEN
    RETURN jsonb_build_object('ok', true, 'updated', false, 'charge_id', p_charge_id);
  END IF;
  UPDATE public.venue_charges SET pay_url = p_pay_url WHERE id = p_charge_id;
  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_charge.team_id, v_charge.venue_id), NULL, 'system', 'stripe_webhook',
          'charge_pay_url_set', 'venue_charge', p_charge_id::text,
          jsonb_build_object('pay_url', p_pay_url));
  RETURN jsonb_build_object('ok', true, 'updated', true, 'charge_id', p_charge_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_set_charge_pay_url(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_set_charge_pay_url(uuid, text) TO service_role;

-- ── 3. get_membership_reminders_due — add pay_url (payment_due only) + de-storm ─────
-- Rebuilt on the mig-276 body. payment_due now: (a) SUPPRESSES charges with a Stripe
-- hosted invoice (ch.pay_url IS NOT NULL → Stripe dunns them), (b) carries the venue's
-- generic payment_link as the email's pay link for the remaining cash/manual charges.
-- The other three kinds carry pay_url = NULL (they already use passUrl). service_role only.
CREATE OR REPLACE FUNCTION public.get_membership_reminders_due()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  WITH base AS (
    SELECT 'welcome'::text AS kind,
           m.id::text AS entity_key,
           c.email, c.first_name, vn.name AS venue_name, t.name AS tier_name,
           m.amount_pence, m.period, m.started_at::text AS date_label, m.pass_token,
           NULL::text AS pay_url
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.started_at >= current_date - 1
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'renewal_due', m.id::text || ':' || m.renews_at::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.renews_at::text, m.pass_token,
           NULL::text
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.renews_at BETWEEN current_date AND current_date + 7
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'freeze_ending', m.id::text || ':' || m.frozen_until::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.frozen_until::text, m.pass_token,
           NULL::text
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'paused' AND m.frozen_until IS NOT NULL
       AND m.frozen_until BETWEEN current_date AND current_date + 3
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'payment_due', ch.id::text,
           c.email, c.first_name, vn.name, t.name, ch.amount_due_pence, m.period, ch.due_date::text, m.pass_token,
           vn.payment_link
      FROM public.venue_charges ch
      JOIN public.venue_memberships m      ON m.id = split_part(ch.source_id, ':', 1)::uuid
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE ch.source_type = 'membership' AND ch.status IN ('unpaid','partial')
       AND ch.due_date IS NOT NULL AND ch.due_date <= current_date
       AND ch.pay_url IS NULL                       -- de-storm: Stripe-invoiced charges are dunned by Stripe
       AND m.status IN ('active','ending')
       AND c.email IS NOT NULL AND c.status <> 'erased'
  )
  SELECT jsonb_build_object('ok', true, 'reminders', COALESCE(jsonb_agg(to_jsonb(base)), '[]'::jsonb))
    FROM base;
$fn$;
REVOKE ALL ON FUNCTION public.get_membership_reminders_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_membership_reminders_due() TO service_role;

-- ── 4. get_my_money — add pay_url per owed charge (Stripe hosted invoice → else the
-- venue's generic payment_link). Rebuilt on the mig-404 body; the only change is the ch
-- CTE picks up vc.venue_id + vc.pay_url, joins venues, and the charge object adds pay_url.
CREATE OR REPLACE FUNCTION public.get_my_money()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_person      uuid;
  v_profile     uuid;
  v_memberships jsonb;
  v_charges     jsonb;
  v_casual      jsonb;
  v_owed        int := 0;
  v_paid_count  int := 0;
  v_upcoming    int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_person  FROM public.people          WHERE auth_user_id = v_uid;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;

  WITH mine AS (
    SELECT vm.id, vm.member_profile_id, vm.club_id, vm.tier_id, vm.period,
           vm.amount_pence, vm.status, vm.renews_at, vm.stripe_subscription_id
    FROM public.venue_memberships vm
    WHERE v_profile IS NOT NULL
      AND ( vm.member_profile_id = v_profile
            OR vm.payer_profile_id = v_profile
            OR vm.member_profile_id IN (
                 SELECT mg.child_profile_id FROM public.member_guardians mg
                 WHERE mg.guardian_profile_id = v_profile) )
      AND vm.status <> 'cancelled'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', m.id,
    'who_for',       CASE WHEN m.member_profile_id = v_profile THEN 'self'
                         ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self',       (m.member_profile_id = v_profile),
    'club_name',     c.name,
    'tier_name',     t.name,
    'period',        m.period,
    'amount_pence',  m.amount_pence,
    'status',        m.status,
    'renews_at',     m.renews_at,
    'is_stripe',     (m.stripe_subscription_id IS NOT NULL)
  ) ORDER BY (m.member_profile_id = v_profile) DESC, c.name NULLS LAST), '[]'::jsonb)
  INTO v_memberships
  FROM mine m
  LEFT JOIN public.member_profiles mp ON mp.id = m.member_profile_id
  LEFT JOIN public.clubs c ON c.id = m.club_id
  LEFT JOIN public.venue_membership_tiers t ON t.id = m.tier_id;

  WITH mine AS (
    SELECT vm.id, vm.member_profile_id, vm.club_id
    FROM public.venue_memberships vm
    WHERE v_profile IS NOT NULL
      AND ( vm.member_profile_id = v_profile
            OR vm.payer_profile_id = v_profile
            OR vm.member_profile_id IN (
                 SELECT mg.child_profile_id FROM public.member_guardians mg
                 WHERE mg.guardian_profile_id = v_profile) )
      AND vm.status <> 'cancelled'
  ),
  ch AS (
    SELECT vc.id, vc.amount_due_pence, vc.status, vc.due_date, vc.created_at,
           vc.billing_run_id, vc.venue_id, vc.pay_url,
           m.member_profile_id, m.club_id,
           GREATEST(COALESCE((
             SELECT SUM(CASE WHEN vp.kind='payment' THEN vp.amount_pence ELSE -vp.amount_pence END)
             FROM public.venue_payments vp
             WHERE vp.charge_id = vc.id AND vp.voided_at IS NULL), 0), 0) AS paid_pence
    FROM public.venue_charges vc
    JOIN mine m ON m.id::text = split_part(vc.source_id, ':', 1)
    WHERE vc.source_type = 'membership'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'charge_id',        ch.id,
    'stream',           'membership',
    'who_for',          CASE WHEN ch.member_profile_id = v_profile THEN 'self'
                            ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self',          (ch.member_profile_id = v_profile),
    'label',            COALESCE(br.label, c.name, 'Membership'),
    'amount_due_pence', ch.amount_due_pence,
    'paid_pence',       ch.paid_pence,
    'status',           ch.status,
    'due_date',         ch.due_date,
    'pay_url',          COALESCE(ch.pay_url, vn.payment_link)
  ) ORDER BY ch.due_date DESC NULLS LAST, ch.created_at DESC), '[]'::jsonb)
  INTO v_charges
  FROM ch
  LEFT JOIN public.member_profiles mp ON mp.id = ch.member_profile_id
  LEFT JOIN public.clubs c ON c.id = ch.club_id
  LEFT JOIN public.venue_billing_runs br ON br.id = ch.billing_run_id
  LEFT JOIN public.venues vn ON vn.id = ch.venue_id;

  SELECT
    COALESCE(SUM(CASE WHEN (e->>'status') IN ('unpaid','partial')
                      THEN (e->>'amount_due_pence')::int - (e->>'paid_pence')::int
                      ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE (e->>'status') = 'paid'),
    COUNT(*) FILTER (WHERE (e->>'status') IN ('unpaid','partial'))
  INTO v_owed, v_paid_count, v_upcoming
  FROM jsonb_array_elements(COALESCE(v_charges, '[]'::jsonb)) e;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',         pl.id,
      'team_id',    pl.team_id,
      'player_id',  pl.player_id,
      'match_id',   pl.match_id,
      'amount',     pl.amount,
      'type',       pl.type,
      'status',     pl.status,
      'method',     pl.method,
      'paid_by',    pl.paid_by,
      'paid_at',    pl.paid_at,
      'note',       pl.note,
      'created_at', pl.created_at,
      'updated_at', pl.updated_at
    ) ORDER BY pl.created_at DESC), '[]'::jsonb)
  INTO v_casual
  FROM public.payment_ledger pl
  WHERE v_person IS NOT NULL
    AND pl.player_id IN (
      SELECT p.id FROM public.players p
      WHERE p.person_id = v_person AND COALESCE(p.disabled, false) = false
    );

  RETURN jsonb_build_object(
    'ok',          true,
    'person_id',   v_person,
    'profile_id',  v_profile,
    'memberships', COALESCE(v_memberships, '[]'::jsonb),
    'charges',     COALESCE(v_charges, '[]'::jsonb),
    'casual',      COALESCE(v_casual, '[]'::jsonb),
    'summary',     jsonb_build_object(
                     'owed_pence',     v_owed,
                     'paid_count',     v_paid_count,
                     'upcoming_count', v_upcoming)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_money() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_money() TO authenticated;

-- ── 5. venue_payment_reconciliation (READ) — operator reconciliation view (#6.3) ───
-- Per-period raised / paid / outstanding / overdue + collection rate + a by_method split
-- (Stripe vs cash/card/bank_transfer). Read-only (STABLE) — no audit. Period filter on
-- charge due_date (NULL bounds = all-time). manage_memberships gated, venue-token backdoor.
CREATE OR REPLACE FUNCTION public.venue_payment_reconciliation(
  p_venue_token text, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  WITH ch AS (
    SELECT c.id, c.amount_due_pence, c.status, c.due_date,
           COALESCE((SELECT SUM(CASE WHEN p.kind='payment' THEN p.amount_pence ELSE -p.amount_pence END)
                     FROM public.venue_payments p WHERE p.charge_id=c.id AND p.voided_at IS NULL),0) AS paid_pence
    FROM public.venue_charges c
    WHERE c.venue_id = v_venue_id
      AND (p_from IS NULL OR c.due_date >= p_from)
      AND (p_to   IS NULL OR c.due_date <= p_to)
  ),
  pay AS (
    SELECT p.method,
           SUM(CASE WHEN p.kind='payment' THEN p.amount_pence ELSE -p.amount_pence END) AS pence
    FROM public.venue_payments p
    JOIN public.venue_charges c ON c.id = p.charge_id AND c.venue_id = v_venue_id
    WHERE p.voided_at IS NULL
      AND (p_from IS NULL OR c.due_date >= p_from)
      AND (p_to   IS NULL OR c.due_date <= p_to)
    GROUP BY p.method
  )
  SELECT jsonb_build_object(
    'ok', true,
    'from', p_from, 'to', p_to,
    'summary', jsonb_build_object(
      'charge_count',      (SELECT count(*) FROM ch),
      'raised_pence',      COALESCE((SELECT SUM(amount_due_pence) FROM ch WHERE status<>'refunded'),0),
      'paid_pence',        COALESCE((SELECT SUM(paid_pence)       FROM ch WHERE status<>'refunded'),0),
      'outstanding_pence', COALESCE((SELECT SUM(GREATEST(amount_due_pence-paid_pence,0)) FROM ch WHERE status<>'refunded'),0),
      'overdue_pence',     COALESCE((SELECT SUM(GREATEST(amount_due_pence-paid_pence,0)) FROM ch
                                      WHERE status IN ('unpaid','partial') AND due_date IS NOT NULL AND due_date <= current_date),0),
      'overdue_count',     COALESCE((SELECT count(*) FROM ch
                                      WHERE status IN ('unpaid','partial') AND due_date IS NOT NULL AND due_date <= current_date),0),
      'collection_rate',   (SELECT CASE WHEN COALESCE(SUM(amount_due_pence),0)=0 THEN NULL
                              ELSE round(100.0*SUM(paid_pence)/SUM(amount_due_pence),1) END
                            FROM ch WHERE status<>'refunded')
    ),
    'by_method', COALESCE((SELECT jsonb_object_agg(COALESCE(method,'unknown'), pence) FROM pay),'{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_payment_reconciliation(text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_payment_reconciliation(text,date,date) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
