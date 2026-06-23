-- 405_stripe_phase3_mass_invoicing_down.sql
-- Reverses mig 405. Restores get_my_money + venue_get_charges to their mig-404/mig-181 bodies,
-- drops the Phase-3 bulk RPCs + the billing-run table + the billing_run_id column.
-- NOTE: re-applying the prior bodies is left to mig 404 / 181 if a full rollback is needed;
-- this down script only removes what 405 added and restores the two changed functions to
-- read the same shape WITHOUT the run-label join (label falls back to club name).

DROP FUNCTION IF EXISTS public.venue_list_billing_runs(text,int);
DROP FUNCTION IF EXISTS public.venue_void_billing_run(text,uuid);
DROP FUNCTION IF EXISTS public.venue_bulk_charge_commit(text,text,text,text,int,date,boolean,boolean,uuid[]);
DROP FUNCTION IF EXISTS public.venue_bulk_charge_preview(text,text,text,text,int,date,boolean);
DROP FUNCTION IF EXISTS public.stripe_record_charge_payment(uuid,text,text,integer,timestamptz);
DROP FUNCTION IF EXISTS public._bulk_cohort_memberships(text,text,text);

-- get_my_money — restore the mig-404 label (club name, no run join)
CREATE OR REPLACE FUNCTION public.get_my_money()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_person uuid; v_profile uuid;
  v_memberships jsonb; v_charges jsonb; v_casual jsonb;
  v_owed int := 0; v_paid_count int := 0; v_upcoming int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_person  FROM public.people          WHERE auth_user_id = v_uid;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  WITH mine AS (
    SELECT vm.id, vm.member_profile_id, vm.club_id, vm.tier_id, vm.period,
           vm.amount_pence, vm.status, vm.renews_at, vm.stripe_subscription_id
    FROM public.venue_memberships vm
    WHERE v_profile IS NOT NULL
      AND ( vm.member_profile_id = v_profile OR vm.payer_profile_id = v_profile
            OR vm.member_profile_id IN (SELECT mg.child_profile_id FROM public.member_guardians mg
                 WHERE mg.guardian_profile_id = v_profile) )
      AND vm.status <> 'cancelled'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', m.id,
    'who_for', CASE WHEN m.member_profile_id = v_profile THEN 'self'
                    ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self', (m.member_profile_id = v_profile), 'club_name', c.name, 'tier_name', t.name,
    'period', m.period, 'amount_pence', m.amount_pence, 'status', m.status,
    'renews_at', m.renews_at, 'is_stripe', (m.stripe_subscription_id IS NOT NULL)
  ) ORDER BY (m.member_profile_id = v_profile) DESC, c.name NULLS LAST), '[]'::jsonb)
  INTO v_memberships FROM mine m
  LEFT JOIN public.member_profiles mp ON mp.id = m.member_profile_id
  LEFT JOIN public.clubs c ON c.id = m.club_id
  LEFT JOIN public.venue_membership_tiers t ON t.id = m.tier_id;
  WITH mine AS (
    SELECT vm.id, vm.member_profile_id, vm.club_id FROM public.venue_memberships vm
    WHERE v_profile IS NOT NULL
      AND ( vm.member_profile_id = v_profile OR vm.payer_profile_id = v_profile
            OR vm.member_profile_id IN (SELECT mg.child_profile_id FROM public.member_guardians mg
                 WHERE mg.guardian_profile_id = v_profile) )
      AND vm.status <> 'cancelled'
  ),
  ch AS (
    SELECT vc.id, vc.amount_due_pence, vc.status, vc.due_date, vc.created_at,
           m.member_profile_id, m.club_id,
           GREATEST(COALESCE((SELECT SUM(CASE WHEN vp.kind='payment' THEN vp.amount_pence ELSE -vp.amount_pence END)
             FROM public.venue_payments vp WHERE vp.charge_id = vc.id AND vp.voided_at IS NULL), 0), 0) AS paid_pence
    FROM public.venue_charges vc
    JOIN mine m ON m.id::text = split_part(vc.source_id, ':', 1)
    WHERE vc.source_type = 'membership'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'charge_id', ch.id, 'stream', 'membership',
    'who_for', CASE WHEN ch.member_profile_id = v_profile THEN 'self'
                    ELSE NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') END,
    'is_self', (ch.member_profile_id = v_profile), 'label', COALESCE(c.name, 'Membership'),
    'amount_due_pence', ch.amount_due_pence, 'paid_pence', ch.paid_pence,
    'status', ch.status, 'due_date', ch.due_date
  ) ORDER BY ch.due_date DESC NULLS LAST, ch.created_at DESC), '[]'::jsonb)
  INTO v_charges FROM ch
  LEFT JOIN public.member_profiles mp ON mp.id = ch.member_profile_id
  LEFT JOIN public.clubs c ON c.id = ch.club_id;
  SELECT COALESCE(SUM(CASE WHEN (e->>'status') IN ('unpaid','partial')
                      THEN (e->>'amount_due_pence')::int - (e->>'paid_pence')::int ELSE 0 END), 0),
         COUNT(*) FILTER (WHERE (e->>'status') = 'paid'),
         COUNT(*) FILTER (WHERE (e->>'status') IN ('unpaid','partial'))
  INTO v_owed, v_paid_count, v_upcoming FROM jsonb_array_elements(COALESCE(v_charges, '[]'::jsonb)) e;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', pl.id, 'team_id', pl.team_id, 'player_id', pl.player_id, 'match_id', pl.match_id,
      'amount', pl.amount, 'type', pl.type, 'status', pl.status, 'method', pl.method,
      'paid_by', pl.paid_by, 'paid_at', pl.paid_at, 'note', pl.note,
      'created_at', pl.created_at, 'updated_at', pl.updated_at
    ) ORDER BY pl.created_at DESC), '[]'::jsonb)
  INTO v_casual FROM public.payment_ledger pl
  WHERE v_person IS NOT NULL AND pl.player_id IN (
      SELECT p.id FROM public.players p WHERE p.person_id = v_person AND COALESCE(p.disabled, false) = false);
  RETURN jsonb_build_object('ok', true, 'person_id', v_person, 'profile_id', v_profile,
    'memberships', COALESCE(v_memberships, '[]'::jsonb), 'charges', COALESCE(v_charges, '[]'::jsonb),
    'casual', COALESCE(v_casual, '[]'::jsonb),
    'summary', jsonb_build_object('owed_pence', v_owed, 'paid_count', v_paid_count, 'upcoming_count', v_upcoming));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_money() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_money() TO authenticated;

-- venue_get_charges — restore the mig-181 body (no run join / run_label)
CREATE OR REPLACE FUNCTION public.venue_get_charges(
  p_venue_token text, p_status text DEFAULT NULL, p_source_type text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
      'charge_count', (SELECT count(*) FROM ch),
      'owed_pence', COALESCE((SELECT SUM(amount_due_pence) FROM ch WHERE status <> 'refunded'), 0),
      'collected_pence', COALESCE((SELECT SUM(paid_pence) FROM ch WHERE status <> 'refunded'), 0),
      'outstanding_pence', COALESCE((SELECT SUM(GREATEST(amount_due_pence - paid_pence, 0)) FROM ch WHERE status <> 'refunded'), 0),
      'collection_rate', (SELECT CASE WHEN COALESCE(SUM(amount_due_pence),0) = 0 THEN NULL
                            ELSE round(100.0 * SUM(paid_pence) / SUM(amount_due_pence), 1) END FROM ch WHERE status <> 'refunded'),
      'by_status', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM ch GROUP BY status) s), '{}'::jsonb)
    ),
    'charges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'source_type', source_type, 'source_id', source_id, 'team_id', team_id,
        'competition_id', competition_id, 'amount_due_pence', amount_due_pence,
        'paid_pence', paid_pence, 'balance_pence', GREATEST(amount_due_pence - paid_pence, 0),
        'status', status, 'due_date', due_date) ORDER BY due_date DESC NULLS LAST, created_at DESC)
      FROM (SELECT * FROM ch ORDER BY due_date DESC NULLS LAST, created_at DESC LIMIT GREATEST(p_limit, 0)) lim
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_get_charges(text, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_get_charges(text, text, text, int) TO anon, authenticated;

ALTER TABLE public.venue_charges DROP CONSTRAINT IF EXISTS venue_charges_billing_run_fk;
ALTER TABLE public.venue_charges DROP COLUMN IF EXISTS billing_run_id;
DROP TABLE IF EXISTS public.venue_billing_runs;

SELECT pg_notify('pgrst', 'reload schema');
