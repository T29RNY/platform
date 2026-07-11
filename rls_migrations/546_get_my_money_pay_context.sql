-- 546: get_my_money — add `stripe_available` + `manual_pay_url` to every charge row.
--
-- Walk-gap #4: the standalone "Pay now" on a pre-existing fee (GuardianMembership → Fees)
-- must open the SAME shared BookPaySheet (card / bank / cash-always) as a book-and-pay
-- booking, so it never dead-ends when the club's Stripe isn't connected. BookPaySheet gates
-- its card button on `ctx.stripe_available` and its bank button on `ctx.manual_pay_url` — two
-- fields the book-and-pay result (mig 543) carries but `get_my_money` did not emit. This adds
-- them to BOTH charge builders (membership + class), identically to mig 543:
--   • stripe_available — the club's Stripe Connect is live for this charge's venue
--   • manual_pay_url   — the club's un-coalesced venues.payment_link (bank/pay-online link)
-- Purely additive: existing keys (incl. the coalesced `pay_url`) are byte-unchanged.
--
-- Consumers (Hard Rule #14): apps/inorout GuardianMembership.jsx (Fees "Pay now" → BookPaySheet).

CREATE OR REPLACE FUNCTION public.get_my_money()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_person       uuid;
  v_profile      uuid;
  v_memberships  jsonb;
  v_charges      jsonb;
  v_charges_cls  jsonb;
  v_casual       jsonb;
  v_owed         int := 0;
  v_paid_count   int := 0;
  v_upcoming     int := 0;
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
    'member_profile_id', m.member_profile_id,
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
    'member_profile_id', ch.member_profile_id,
    'who_for',          CASE WHEN ch.member_profile_id = v_profile THEN 'self'
                            ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self',          (ch.member_profile_id = v_profile),
    'label',            COALESCE(br.label, c.name, 'Membership'),
    'amount_due_pence', ch.amount_due_pence,
    'paid_pence',       ch.paid_pence,
    'status',           ch.status,
    'due_date',         ch.due_date,
    'pay_url',          COALESCE(ch.pay_url, vn.payment_link),
    'manual_pay_url',   vn.payment_link,
    'stripe_available', EXISTS(SELECT 1 FROM public.venue_integrations vi
                               WHERE vi.venue_id = ch.venue_id AND vi.provider = 'stripe' AND vi.status = 'connected')
  ) ORDER BY ch.due_date DESC NULLS LAST, ch.created_at DESC), '[]'::jsonb)
  INTO v_charges
  FROM ch
  LEFT JOIN public.member_profiles mp ON mp.id = ch.member_profile_id
  LEFT JOIN public.clubs c ON c.id = ch.club_id
  LEFT JOIN public.venue_billing_runs br ON br.id = ch.billing_run_id
  LEFT JOIN public.venues vn ON vn.id = ch.venue_id;

  WITH my_profiles AS (
    SELECT v_profile AS pid WHERE v_profile IS NOT NULL
    UNION
    SELECT mg.child_profile_id FROM public.member_guardians mg
     WHERE mg.guardian_profile_id = v_profile
  ),
  clsch AS (
    SELECT vc.id, vc.amount_due_pence, vc.status, vc.due_date, vc.created_at,
           vc.venue_id, vc.pay_url, b.member_profile_id,
           ct.name AS class_name,
           GREATEST(COALESCE((
             SELECT SUM(CASE WHEN vp.kind='payment' THEN vp.amount_pence ELSE -vp.amount_pence END)
             FROM public.venue_payments vp
             WHERE vp.charge_id = vc.id AND vp.voided_at IS NULL), 0), 0) AS paid_pence
    FROM public.venue_charges vc
    JOIN public.venue_class_bookings b ON b.id::text = vc.source_id
    JOIN public.venue_class_sessions s ON s.id = b.session_id
    JOIN public.venue_class_types   ct ON ct.id = s.class_type_id
    WHERE vc.source_type = 'class'
      AND vc.status <> 'refunded'
      AND b.member_profile_id IN (SELECT pid FROM my_profiles WHERE pid IS NOT NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'charge_id',        clsch.id,
    'stream',           'class',
    'member_profile_id', clsch.member_profile_id,
    'who_for',          CASE WHEN clsch.member_profile_id = v_profile THEN 'self'
                            ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self',          (clsch.member_profile_id = v_profile),
    'label',            COALESCE(clsch.class_name, 'Class'),
    'amount_due_pence', clsch.amount_due_pence,
    'paid_pence',       clsch.paid_pence,
    'status',           clsch.status,
    'due_date',         clsch.due_date,
    'pay_url',          COALESCE(clsch.pay_url, vn.payment_link),
    'manual_pay_url',   vn.payment_link,
    'stripe_available', EXISTS(SELECT 1 FROM public.venue_integrations vi
                               WHERE vi.venue_id = clsch.venue_id AND vi.provider = 'stripe' AND vi.status = 'connected')
  ) ORDER BY clsch.due_date DESC NULLS LAST, clsch.created_at DESC), '[]'::jsonb)
  INTO v_charges_cls
  FROM clsch
  LEFT JOIN public.member_profiles mp ON mp.id = clsch.member_profile_id
  LEFT JOIN public.venues vn ON vn.id = clsch.venue_id;

  v_charges := COALESCE(v_charges, '[]'::jsonb) || COALESCE(v_charges_cls, '[]'::jsonb);

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
