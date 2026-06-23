-- 408 DOWN — revert Stripe Phase 6 (collection, chasing & reporting).

DROP FUNCTION IF EXISTS public.venue_payment_reconciliation(text,date,date);
DROP FUNCTION IF EXISTS public.stripe_set_charge_pay_url(uuid,text);

-- Restore get_membership_reminders_due to its mig-276 body (no pay_url, no de-storm).
CREATE OR REPLACE FUNCTION public.get_membership_reminders_due()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  WITH base AS (
    SELECT 'welcome'::text AS kind, m.id::text AS entity_key,
           c.email, c.first_name, vn.name AS venue_name, t.name AS tier_name,
           m.amount_pence, m.period, m.started_at::text AS date_label, m.pass_token
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.started_at >= current_date - 1
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'renewal_due', m.id::text || ':' || m.renews_at::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.renews_at::text, m.pass_token
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'active' AND m.renews_at BETWEEN current_date AND current_date + 7
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'freeze_ending', m.id::text || ':' || m.frozen_until::text,
           c.email, c.first_name, vn.name, t.name, m.amount_pence, m.period, m.frozen_until::text, m.pass_token
      FROM public.venue_memberships m
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE m.status = 'paused' AND m.frozen_until IS NOT NULL
       AND m.frozen_until BETWEEN current_date AND current_date + 3
       AND c.email IS NOT NULL AND c.status <> 'erased'
    UNION ALL
    SELECT 'payment_due', ch.id::text,
           c.email, c.first_name, vn.name, t.name, ch.amount_due_pence, m.period, ch.due_date::text, m.pass_token
      FROM public.venue_charges ch
      JOIN public.venue_memberships m      ON m.id = split_part(ch.source_id, ':', 1)::uuid
      JOIN public.venue_customers c        ON c.id = m.customer_id
      JOIN public.venue_membership_tiers t ON t.id = m.tier_id
      JOIN public.venues vn                ON vn.id = m.venue_id
     WHERE ch.source_type = 'membership' AND ch.status IN ('unpaid','partial')
       AND ch.due_date IS NOT NULL AND ch.due_date <= current_date
       AND m.status IN ('active','ending')
       AND c.email IS NOT NULL AND c.status <> 'erased'
  )
  SELECT jsonb_build_object('ok', true, 'reminders', COALESCE(jsonb_agg(to_jsonb(base)), '[]'::jsonb))
    FROM base;
$fn$;
REVOKE ALL ON FUNCTION public.get_membership_reminders_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_membership_reminders_due() TO service_role;

-- Restore get_my_money to its mig-404 body (no pay_url) BEFORE dropping the column,
-- else the live function would reference a dropped column.
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
           vc.billing_run_id,
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
    'due_date',         ch.due_date
  ) ORDER BY ch.due_date DESC NULLS LAST, ch.created_at DESC), '[]'::jsonb)
  INTO v_charges
  FROM ch
  LEFT JOIN public.member_profiles mp ON mp.id = ch.member_profile_id
  LEFT JOIN public.clubs c ON c.id = ch.club_id
  LEFT JOIN public.venue_billing_runs br ON br.id = ch.billing_run_id;

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

ALTER TABLE public.venue_charges DROP COLUMN IF EXISTS pay_url;

SELECT pg_notify('pgrst', 'reload schema');
