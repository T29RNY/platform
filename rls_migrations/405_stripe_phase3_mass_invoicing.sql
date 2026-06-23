-- 405_stripe_phase3_mass_invoicing.sql
-- Phase 3 of the full Stripe build (STRIPE_FULL_BUILD_HANDOFF.md): mass invoicing — the
-- headline operator action (scope #6 bulk wizard + remove-individuals, #7 Stripe Invoices
-- for online one-offs, #8 billing-run record + void, #18 pro-rated mass invoicing).
-- Built/tested under Stripe TEST keys; live keys go in Phase 7 — no path here assumes live keys.
--
-- The billable entity is a MEMBERSHIP (venue_memberships). A bulk charge is minted per
-- membership, source_type='membership', source_id='<membership_id>:run:<run_id>', so it
-- surfaces in the payer's get_my_money() (mig 404) verbatim — split_part(source_id,':',1)
-- already matches. Cohorts (tier / club / team) resolve to a set of active memberships.
--
--   0. venue_charges += billing_run_id (the run that minted it; the handoff's run_id).
--   1. venue_billing_runs — who/what/when/totals/status. cohort_type is OPEN TEXT so a later
--      'ad_hoc' (non-member) cohort needs no migration.
--   2. _bulk_cohort_memberships(venue, cohort_type, cohort_ref) — ONE cohort resolver shared
--      by preview + commit so they can never drift. STABLE, internal.
--   3. venue_bulk_charge_preview(...) — READ-only. Every membership with will-invoice OR
--      auto-skip(reason: paused|left|already-billed) + per-member amount (pro-rated when asked,
--      reusing _prorated_first_charge mig 393) + running total.
--   4. venue_bulk_charge_commit(...) — WRITE. One venue_charges row per INCLUDED membership;
--      idempotent per (run, membership); writes the run record. Cash-payers excluded by the
--      operator un-ticking (p_excluded_ids), NOT auto-skipped.
--   5. venue_void_billing_run(...) — WRITE. Soft-void: run -> 'voided', its charges -> 'refunded'
--      (payments left intact, mirrors the mig-181 fixture-void pattern).
--   6. stripe_record_charge_payment(...) — WRITE (service_role, webhook-only). Reconciles a
--      one-off Stripe INVOICE against the PRE-EXISTING bulk charge. (stripe_record_invoice_payment
--      from mig 403 is subscription-keyed and cannot match a one-off invoice — this is its sibling.)
--   7. get_my_money() — LEFT JOIN venue_billing_runs so the run label shows on bulk charges
--      (a value change to the existing 'label' field; no new return field).
--   8. venue_get_charges() — surface billing_run_id + run label on each charge.
--
-- Venue write RPCs: SECDEF, search_path pinned, gated on manage_memberships via _venue_has_cap,
-- audited (Hard Rule #9), granted anon+authenticated (auth enforced inside resolve_venue_caller —
-- the venue_* gotcha; mig-175 authenticated-only applies only to auth.uid()-only RPCs).

-- ── 0. venue_charges gains the run id ──────────────────────────────────────────
ALTER TABLE public.venue_charges
  ADD COLUMN IF NOT EXISTS billing_run_id uuid;

-- ── 1. venue_billing_runs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_billing_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  label         text NOT NULL,
  cohort_type   text NOT NULL,                 -- 'tier' | 'club' | 'team' (open text; 'ad_hoc' later)
  cohort_ref    text,                          -- tier_id / club_id / team_id (text)
  amount_pence  int  NOT NULL CHECK (amount_pence >= 0),
  due_date      date,
  prorate       boolean NOT NULL DEFAULT false,
  pay_online    boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','voided')),
  member_count  int  NOT NULL DEFAULT 0,
  total_pence   int  NOT NULL DEFAULT 0,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  voided_at     timestamptz
);
CREATE INDEX IF NOT EXISTS venue_billing_runs_venue_idx ON public.venue_billing_runs (venue_id);

-- FK from charges -> runs (added after the table exists). ON DELETE SET NULL: deleting a run
-- (never done in app; soft-void only) would orphan, not cascade-delete, the ledger charges.
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_charges_billing_run_fk') THEN
    ALTER TABLE public.venue_charges
      ADD CONSTRAINT venue_charges_billing_run_fk
      FOREIGN KEY (billing_run_id) REFERENCES public.venue_billing_runs(id) ON DELETE SET NULL;
  END IF;
END
$fk$;
CREATE INDEX IF NOT EXISTS venue_charges_billing_run_idx
  ON public.venue_charges (billing_run_id) WHERE billing_run_id IS NOT NULL;

ALTER TABLE public.venue_billing_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_billing_runs FROM anon, authenticated;  -- RPC-only (SECDEF), like venue_charges

-- ── 2. shared cohort resolver (internal) ───────────────────────────────────────
-- Returns the candidate memberships for a cohort, with the per-tier season window + basis
-- needed for pro-rating. status filtered to the billable-or-skippable set (cancelled =
-- long gone, not shown). One source of truth so preview and commit cannot diverge.
CREATE OR REPLACE FUNCTION public._bulk_cohort_memberships(
  p_venue_id text, p_cohort_type text, p_cohort_ref text)
RETURNS TABLE(
  membership_id     uuid,
  member_profile_id uuid,
  payer_profile_id  uuid,
  member_name       text,
  status            text,
  frozen_until      date,
  tier_id           uuid,
  season_start      date,
  season_end        date,
  proration_basis   text)
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT vm.id,
         vm.member_profile_id,
         COALESCE(vm.payer_profile_id, vm.member_profile_id),
         NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), ''),
         vm.status,
         vm.frozen_until,
         vm.tier_id,
         t.season_start,
         t.season_end,
         COALESCE(t.proration_basis, 'none')
  FROM public.venue_memberships vm
  LEFT JOIN public.member_profiles mp        ON mp.id = vm.member_profile_id
  LEFT JOIN public.venue_membership_tiers t  ON t.id  = vm.tier_id
  WHERE vm.venue_id = p_venue_id
    AND vm.status IN ('active','paused','ending')
    AND (
      (p_cohort_type = 'tier' AND vm.tier_id = p_cohort_ref::uuid)
      OR (p_cohort_type = 'club' AND vm.club_id = p_cohort_ref)
      OR (p_cohort_type = 'team' AND vm.member_profile_id IN (
            SELECT ctm.member_profile_id FROM public.club_team_members ctm
            WHERE ctm.team_id = p_cohort_ref::uuid AND ctm.is_active))
    );
$fn$;
REVOKE ALL ON FUNCTION public._bulk_cohort_memberships(text,text,text) FROM PUBLIC;
-- internal helper, only called inside the SECDEF RPCs below — strip the default role grants.
REVOKE EXECUTE ON FUNCTION public._bulk_cohort_memberships(text,text,text) FROM anon, authenticated;

-- ── 3. venue_bulk_charge_preview (READ) ────────────────────────────────────────
-- p_label is taken at preview so the already-billed guard can dedupe against a prior
-- non-voided run with the same label (don't run "U12 Tournament Fee" twice).
CREATE OR REPLACE FUNCTION public.venue_bulk_charge_preview(
  p_venue_token text,
  p_cohort_type text,
  p_cohort_ref  text,
  p_label       text,
  p_amount_pence int,
  p_due_date    date    DEFAULT NULL,
  p_prorate     boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_label text := NULLIF(btrim(p_label), '');
  v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_cohort_type NOT IN ('tier','club','team') THEN
    RAISE EXCEPTION 'invalid_cohort_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount_pence IS NULL OR p_amount_pence < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  WITH cohort AS (
    SELECT * FROM public._bulk_cohort_memberships(v_venue_id, p_cohort_type, p_cohort_ref)
  ),
  scored AS (
    SELECT
      c.membership_id,
      c.member_profile_id,
      c.payer_profile_id,
      COALESCE(c.member_name, 'Member') AS member_name,
      c.status,
      -- per-member amount: pro-rated season slice when asked + the tier has a window,
      -- else the flat amount. Joining fee is enrolment-only, never added here.
      CASE WHEN p_prorate
           THEN public._prorated_first_charge(p_amount_pence, c.proration_basis,
                                              current_date, c.season_start, c.season_end)
           ELSE p_amount_pence END AS amount_pence,
      -- classification: left / paused lock the row; already-billed if a non-voided run with
      -- the same label already minted a non-voided charge for this membership.
      CASE
        WHEN c.status = 'ending' THEN 'left'
        WHEN c.status = 'paused' OR (c.frozen_until IS NOT NULL AND c.frozen_until > current_date) THEN 'paused'
        WHEN v_label IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.venue_charges vc
               JOIN public.venue_billing_runs br ON br.id = vc.billing_run_id
               WHERE split_part(vc.source_id, ':', 1) = c.membership_id::text
                 AND vc.source_type = 'membership'
                 AND vc.status <> 'refunded'
                 AND br.status <> 'voided'
                 AND br.label = v_label)
             THEN 'already-billed'
        ELSE NULL
      END AS skip_reason
    FROM cohort c
  )
  SELECT jsonb_build_object(
    'ok', true,
    'cohort_type', p_cohort_type,
    'cohort_ref', p_cohort_ref,
    'label', v_label,
    'prorate', p_prorate,
    'due_date', p_due_date,
    'member_count',     (SELECT count(*) FROM scored),
    'include_count',    (SELECT count(*) FROM scored WHERE skip_reason IS NULL),
    'skip_count',       (SELECT count(*) FROM scored WHERE skip_reason IS NOT NULL),
    'include_total_pence', COALESCE((SELECT SUM(amount_pence) FROM scored WHERE skip_reason IS NULL), 0),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'membership_id',    membership_id,
        'member_profile_id',member_profile_id,
        'payer_profile_id', payer_profile_id,
        'member_name',      member_name,
        'status',           status,
        'amount_pence',     amount_pence,
        'will_invoice',     (skip_reason IS NULL),
        'skip_reason',      skip_reason
      ) ORDER BY (skip_reason IS NOT NULL), member_name) FROM scored
    ), '[]'::jsonb)
  ) INTO v_rows;

  RETURN v_rows;
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_bulk_charge_preview(text,text,text,text,int,date,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_bulk_charge_preview(text,text,text,text,int,date,boolean) TO anon, authenticated;

-- ── 4. venue_bulk_charge_commit (WRITE) ────────────────────────────────────────
-- One venue_charges row per INCLUDED membership (auto-skips + p_excluded_ids removed).
-- Idempotent: source_id carries the unique run_id, so a re-commit of the same run is a
-- no-op via the (source_type, source_id, COALESCE(team_id,'')) unique index.
CREATE OR REPLACE FUNCTION public.venue_bulk_charge_commit(
  p_venue_token text,
  p_cohort_type text,
  p_cohort_ref  text,
  p_label       text,
  p_amount_pence int,
  p_due_date    date    DEFAULT NULL,
  p_prorate     boolean DEFAULT false,
  p_pay_online  boolean DEFAULT false,
  p_excluded_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_label text := NULLIF(btrim(p_label), '');
  v_run_id uuid;
  v_excluded uuid[] := COALESCE(p_excluded_ids, '{}'::uuid[]);
  v_count int := 0;
  v_total int := 0;
  v_charges jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_label IS NULL THEN RAISE EXCEPTION 'label_required' USING ERRCODE = 'P0001'; END IF;
  IF p_cohort_type NOT IN ('tier','club','team') THEN
    RAISE EXCEPTION 'invalid_cohort_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount_pence IS NULL OR p_amount_pence < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_billing_runs
    (venue_id, label, cohort_type, cohort_ref, amount_pence, due_date, prorate, pay_online,
     status, created_by)
  VALUES
    (v_venue_id, v_label, p_cohort_type, p_cohort_ref, p_amount_pence, p_due_date, p_prorate,
     p_pay_online, 'sent', v_caller.actor_ident)
  RETURNING id INTO v_run_id;

  -- mint one charge per included, billable membership; recompute the run totals from what
  -- actually landed (the same classification the preview applied, evaluated server-side).
  WITH cohort AS (
    SELECT * FROM public._bulk_cohort_memberships(v_venue_id, p_cohort_type, p_cohort_ref)
  ),
  billable AS (
    SELECT c.membership_id,
           CASE WHEN p_prorate
                THEN public._prorated_first_charge(p_amount_pence, c.proration_basis,
                                                  current_date, c.season_start, c.season_end)
                ELSE p_amount_pence END AS amount_pence
    FROM cohort c
    WHERE c.status = 'active'
      AND NOT (c.frozen_until IS NOT NULL AND c.frozen_until > current_date)
      AND NOT (c.membership_id = ANY (v_excluded))
      AND NOT EXISTS (
        SELECT 1 FROM public.venue_charges vc
        JOIN public.venue_billing_runs br ON br.id = vc.billing_run_id
        WHERE split_part(vc.source_id, ':', 1) = c.membership_id::text
          AND vc.source_type = 'membership'
          AND vc.status <> 'refunded'
          AND br.status <> 'voided'
          AND br.label = v_label
          AND br.id <> v_run_id)
  ),
  ins AS (
    INSERT INTO public.venue_charges
      (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status,
       due_date, billing_run_id)
    SELECT v_venue_id, 'membership',
           b.membership_id::text || ':run:' || v_run_id::text,
           NULL, NULL, b.amount_pence, 'unpaid', p_due_date, v_run_id
    FROM billable b
    ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING
    RETURNING id, source_id, amount_due_pence
  )
  SELECT count(*), COALESCE(SUM(amount_due_pence), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'charge_id', id,
           'membership_id', split_part(source_id, ':', 1),
           'amount_pence', amount_due_pence)), '[]'::jsonb)
    INTO v_count, v_total, v_charges
  FROM ins;

  UPDATE public.venue_billing_runs
     SET member_count = v_count, total_pence = v_total
   WHERE id = v_run_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'bulk_charge_committed', 'venue_billing_run', v_run_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'label', v_label,
                             'cohort_type', p_cohort_type, 'cohort_ref', p_cohort_ref,
                             'amount_pence', p_amount_pence, 'prorate', p_prorate,
                             'pay_online', p_pay_online, 'member_count', v_count,
                             'total_pence', v_total, 'excluded', v_excluded));

  PERFORM public.notify_venue_change(v_venue_id, 'charge_updated');

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'label', v_label,
                            'member_count', v_count, 'total_pence', v_total,
                            'pay_online', p_pay_online, 'charges', v_charges);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_bulk_charge_commit(text,text,text,text,int,date,boolean,boolean,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_bulk_charge_commit(text,text,text,text,int,date,boolean,boolean,uuid[]) TO anon, authenticated;

-- ── 5. venue_void_billing_run (WRITE) ──────────────────────────────────────────
-- Soft-void the whole run (mirrors the mig-181 fixture-void: charges -> 'refunded', which
-- _recompute_charge_status leaves terminal; payments left intact). Money already collected
-- is NOT auto-refunded here — Stripe refunds are Phase 5; 'refunded' here = no longer collectible.
CREATE OR REPLACE FUNCTION public.venue_void_billing_run(
  p_venue_token text, p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_run record;
  v_voided int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_run FROM public.venue_billing_runs WHERE id = p_run_id;
  IF v_run.id IS NULL THEN RAISE EXCEPTION 'run_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_run.venue_id <> v_venue_id THEN RAISE EXCEPTION 'run_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_run.status = 'voided' THEN RAISE EXCEPTION 'run_already_voided' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.venue_charges SET status = 'refunded'
   WHERE billing_run_id = p_run_id AND status <> 'refunded';
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  UPDATE public.venue_billing_runs SET status = 'voided', voided_at = now()
   WHERE id = p_run_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'billing_run_voided', 'venue_billing_run', p_run_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'label', v_run.label,
                             'charges_voided', v_voided));

  PERFORM public.notify_venue_change(v_venue_id, 'charge_updated');

  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'charges_voided', v_voided);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_void_billing_run(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_void_billing_run(text,uuid) TO anon, authenticated;

-- ── 6. stripe_record_charge_payment (WRITE, service_role webhook-only) ─────────
-- Reconciles a one-off Stripe INVOICE (created by /api/stripe-bulk-invoices.js with
-- metadata.iorout_charge_id) against the PRE-EXISTING bulk charge. Distinct from
-- stripe_record_invoice_payment (mig 403), which mints a charge for a SUBSCRIPTION invoice;
-- here the charge already exists, so we only append the 'stripe' payment. Idempotent on
-- external_ref (charge id, else invoice id) so replays / charge.refunded re-fires are no-ops.
CREATE OR REPLACE FUNCTION public.stripe_record_charge_payment(
  p_charge_id uuid, p_invoice_id text, p_charge_ref text,
  p_amount_pence integer, p_paid_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_charge record; v_extref text; v_exists boolean;
BEGIN
  IF p_charge_id IS NULL THEN
    RAISE EXCEPTION 'missing_params' USING ERRCODE='P0001';
  END IF;

  SELECT id, venue_id, team_id, amount_due_pence INTO v_charge
    FROM public.venue_charges WHERE id = p_charge_id;
  IF v_charge.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'charge_not_found');
  END IF;

  v_extref := COALESCE(p_charge_ref, p_invoice_id);

  SELECT EXISTS(SELECT 1 FROM public.venue_payments
                 WHERE charge_id = p_charge_id AND external_ref = v_extref
                   AND kind = 'payment' AND voided_at IS NULL) INTO v_exists;
  IF v_exists THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false, 'reason', 'already',
                              'charge_id', p_charge_id);
  END IF;

  INSERT INTO public.venue_payments (charge_id, kind, amount_pence, method, external_ref, note, taken_by)
  VALUES (p_charge_id, 'payment', COALESCE(p_amount_pence, v_charge.amount_due_pence), 'stripe',
          v_extref, 'Stripe invoice ' || COALESCE(p_invoice_id, v_extref), 'stripe_webhook');
  PERFORM public._recompute_charge_status(p_charge_id);

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_charge.team_id, v_charge.venue_id), NULL, 'system', 'stripe_webhook',
          'bulk_invoice_paid', 'venue_charge', p_charge_id::text,
          jsonb_build_object('invoice_id', p_invoice_id, 'charge_ref', v_extref,
                             'amount_pence', COALESCE(p_amount_pence, v_charge.amount_due_pence)));

  RETURN jsonb_build_object('ok', true, 'recorded', true, 'charge_id', p_charge_id,
                            'charge_status', (SELECT status FROM public.venue_charges WHERE id = p_charge_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.stripe_record_charge_payment(uuid,text,text,integer,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_record_charge_payment(uuid,text,text,integer,timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_record_charge_payment(uuid,text,text,integer,timestamptz) TO service_role;

-- ── 7. get_my_money — surface the bulk-run label on membership charges ─────────
-- Rebuilt on its mig-404 body; the ONLY change is the membership-charge 'label': prefer the
-- billing-run label (so "U12 Tournament Fee" shows instead of the club name) when the charge
-- was minted by a bulk run. No new return field — existing consumers (MemberProfile.jsx) read
-- the same shape.
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

-- ── 8. venue_get_charges — surface billing_run_id + run label per charge ───────
-- Rebuilt on its mig-181 body; adds billing_run_id + run_label to each charge row (and a
-- run join). Additive: PaymentsView gains a "Mass invoice" grouping/badge; existing fields
-- unchanged. anon revoked-then-granted exactly as mig 181.
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
           COALESCE((SELECT SUM(CASE WHEN p.kind='payment' THEN p.amount_pence ELSE -p.amount_pence END)
                     FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid_pence
    FROM venue_charges c
    LEFT JOIN venue_billing_runs br ON br.id = c.billing_run_id
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
        'billing_run_id', billing_run_id, 'run_label', run_label) ORDER BY due_date DESC NULLS LAST, created_at DESC)
      FROM (SELECT * FROM ch ORDER BY due_date DESC NULLS LAST, created_at DESC LIMIT GREATEST(p_limit, 0)) lim
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_get_charges(text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_get_charges(text, text, text, int) TO anon, authenticated;

-- ── 9. venue_list_billing_runs (READ) — the operator's run history + void surface ─
CREATE OR REPLACE FUNCTION public.venue_list_billing_runs(
  p_venue_token text, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'created_at') DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'run_id', br.id, 'label', br.label, 'cohort_type', br.cohort_type,
      'amount_pence', br.amount_pence, 'due_date', br.due_date,
      'prorate', br.prorate, 'pay_online', br.pay_online, 'status', br.status,
      'member_count', br.member_count, 'total_pence', br.total_pence,
      'created_at', br.created_at, 'voided_at', br.voided_at,
      'collected_pence', COALESCE((
        SELECT SUM(CASE WHEN vp.kind='payment' THEN vp.amount_pence ELSE -vp.amount_pence END)
        FROM public.venue_charges vc
        JOIN public.venue_payments vp ON vp.charge_id = vc.id AND vp.voided_at IS NULL
        WHERE vc.billing_run_id = br.id), 0)
    ) AS r
    FROM public.venue_billing_runs br
    WHERE br.venue_id = v_venue_id
    ORDER BY br.created_at DESC
    LIMIT GREATEST(p_limit, 0)
  ) x;

  RETURN jsonb_build_object('ok', true, 'runs', v_result);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_billing_runs(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_list_billing_runs(text,int) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
