-- 404_stripe_phase2_my_money.sql
-- Phase 2 of the full Stripe build (STRIPE_FULL_BUILD_HANDOFF.md): the unified member
-- money view (scope #4 + #5). ONE new authenticated READ RPC. No writes, no live-key path.
--
-- get_my_money() — aggregates the signed-in human's WHOLE money picture across streams,
-- the "Dave" persona test: one place showing (a) his casual match fees, (b) his own
-- memberships, (c) the memberships he pays for as a guardian — paid + owed/upcoming, each
-- row tagged by stream + who-it's-for.
--
-- Identity is resolved exactly as get_my_world() (mig 372/373) does — the person spine
-- bridges the two worlds that are keyed differently:
--   • auth.uid() → people.id         → players → payment_ledger   (casual fees)
--   • auth.uid() → member_profiles.id → venue_memberships         (club money)
-- Casual fees are otherwise only reachable by a player TOKEN (get_my_payment_history,
-- mig 039); that token-scoped RPC is UNCHANGED — this resolver reads the same payment_ledger
-- rows by person instead, returning the IDENTICAL row shape so the existing dbToLedger
-- mapper reuses it verbatim. payment_ledger.amount is whole-pounds int; venue_charges is
-- pence — the two streams are returned in SEPARATE arrays (never summed across), each tagged.
--
-- Memberships I'm responsible for = own ∪ as-payer (payer_profile_id, populated by mig 403)
-- ∪ as-guardian (member_guardians, safety net for legacy/null-payer rows), deduped, non-
-- cancelled. Membership ledger charges live in venue_charges (source_type='membership',
-- source_id = '<membership_id>:<...>'); split_part(source_id,':',1) extracts the id for both
-- the renewal ('id:date') and Stripe-invoice ('id:inv:invoice') forms (mig 403). Charge
-- status is already maintained by _recompute_charge_status; paid_pence is summed from the
-- non-voided venue_payments instalments.
--
-- NOTE (deferred, DECISIONS.md): season one-off (mode=payment) Stripe payments are not yet
-- in our ledger (Phase 1 recorded invoice.* only); they fold in with Phase 3 Stripe Invoices.
-- This resolver is correct & complete for everything Phase 1 records.
--
-- READ-ONLY (STABLE, SECDEF, search_path pinned, authenticated-only, anon REVOKED per the
-- mig-175 default-grant gotcha) — no audit_events (Hard Rule #9 is write-path only).

CREATE OR REPLACE FUNCTION public.get_my_money()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- ── (b)+(c) memberships I'm responsible for: own ∪ as-payer ∪ as-guardian ──────
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

  -- ── membership ledger charges (paid + owed) for those memberships ──────────────
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
    'label',            COALESCE(c.name, 'Membership'),
    'amount_due_pence', ch.amount_due_pence,
    'paid_pence',       ch.paid_pence,
    'status',           ch.status,
    'due_date',         ch.due_date
  ) ORDER BY ch.due_date DESC NULLS LAST, ch.created_at DESC), '[]'::jsonb)
  INTO v_charges
  FROM ch
  LEFT JOIN public.member_profiles mp ON mp.id = ch.member_profile_id
  LEFT JOIN public.clubs c ON c.id = ch.club_id;

  -- summary derived from the built charge array (no second join)
  SELECT
    COALESCE(SUM(CASE WHEN (e->>'status') IN ('unpaid','partial')
                      THEN (e->>'amount_due_pence')::int - (e->>'paid_pence')::int
                      ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE (e->>'status') = 'paid'),
    COUNT(*) FILTER (WHERE (e->>'status') IN ('unpaid','partial'))
  INTO v_owed, v_paid_count, v_upcoming
  FROM jsonb_array_elements(COALESCE(v_charges, '[]'::jsonb)) e;

  -- ── (a) casual match fees — payment_ledger via person → players. Row shape is
  --    byte-identical to get_my_payment_history so dbToLedger maps it unchanged. ──
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

SELECT pg_notify('pgrst', 'reload schema');
