-- 547: coach "who owes" (club_manager_team_payments) — include class/camp fees AND
-- subtract payments made.
--
-- Two correctness gaps vs every other role's view of the SAME venue_charges ledger:
--   (a) the LATERAL counted only source_type='membership', so a family owing a PREPAY
--       camp/class fee (the exact thing mig 543/546 enabled) showed as "Paid / —" to the
--       coach while the guardian + operator both showed it outstanding.
--   (b) `unpaid_amount = sum(amount_due_pence)` ignored `paid_pence`, so a part-paid member
--       read "Owes £full" to the coach vs £remaining everywhere else.
-- Fix: the LATERAL now UNIONs the member's membership charges AND their class/camp charges
-- (via venue_class_bookings.member_profile_id), and sums the REMAINING balance
-- (amount_due − paid, paid computed from venue_payments exactly as get_my_money does).
-- Return SHAPE is unchanged (owes / amount_pence / overdue) — only the values are corrected —
-- so no client change is needed; the coach screens (TeamManagerPayments, SessionsScreen
-- "Subs & payments") render the same fields.
--
-- Consumers (Hard Rule #14): apps/inorout TeamManagerPayments.jsx + SessionsScreen.jsx (coach).

CREATE OR REPLACE FUNCTION public.club_manager_team_payments(p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   uuid;
  v_team_name text;
  v_members   jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT name INTO v_team_name FROM public.club_teams WHERE id = p_team_id;
  IF v_team_name IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_manager' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY owes DESC, nm), '[]'::jsonb) INTO v_members FROM (
    SELECT (COALESCE(ch.unpaid_count, 0) > 0) AS owes,
           trim(COALESCE(mp.first_name, '') || ' ' || COALESCE(mp.last_name, '')) AS nm,
           jsonb_build_object(
             'member_profile_id', mp.id,
             'name', NULLIF(trim(COALESCE(mp.first_name, '') || ' ' || COALESCE(mp.last_name, '')), ''),
             'membership_status', m.status,
             'tier_name', t.name,
             'owes', COALESCE(ch.unpaid_count, 0) > 0,
             'amount_pence', COALESCE(ch.unpaid_amount, 0),
             'overdue', COALESCE(ch.overdue_count, 0) > 0
           ) AS row
    FROM public.club_team_members ctm
    JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
    LEFT JOIN LATERAL (
      SELECT m2.* FROM public.venue_memberships m2
      WHERE m2.member_profile_id = ctm.member_profile_id
      ORDER BY (m2.status = 'active') DESC, m2.created_at DESC LIMIT 1
    ) m ON true
    LEFT JOIN public.venue_membership_tiers t ON t.id = m.tier_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE vc.status IN ('unpaid','partial')) AS unpaid_count,
             sum(GREATEST(vc.amount_due_pence - vc.paid_pence, 0)) FILTER (WHERE vc.status IN ('unpaid','partial')) AS unpaid_amount,
             count(*) FILTER (WHERE vc.status IN ('unpaid','partial') AND vc.due_date <= current_date) AS overdue_count
      FROM (
        -- membership charges keyed by the member's latest membership id
        SELECT c.status, c.amount_due_pence, c.due_date,
               GREATEST(COALESCE((SELECT SUM(CASE WHEN vp.kind='payment' THEN vp.amount_pence ELSE -vp.amount_pence END)
                                  FROM public.venue_payments vp WHERE vp.charge_id = c.id AND vp.voided_at IS NULL), 0), 0) AS paid_pence
        FROM public.venue_charges c
        WHERE c.source_type = 'membership' AND m.id IS NOT NULL AND split_part(c.source_id, ':', 1)::uuid = m.id
        UNION ALL
        -- class/camp charges keyed by the member's own bookings
        SELECT c.status, c.amount_due_pence, c.due_date,
               GREATEST(COALESCE((SELECT SUM(CASE WHEN vp.kind='payment' THEN vp.amount_pence ELSE -vp.amount_pence END)
                                  FROM public.venue_payments vp WHERE vp.charge_id = c.id AND vp.voided_at IS NULL), 0), 0) AS paid_pence
        FROM public.venue_charges c
        JOIN public.venue_class_bookings b ON b.id::text = c.source_id
        WHERE c.source_type = 'class' AND c.status <> 'refunded' AND b.member_profile_id = ctm.member_profile_id
      ) vc
    ) ch ON true
    WHERE ctm.team_id = p_team_id AND ctm.is_active = true
  ) s;

  RETURN jsonb_build_object('ok', true, 'team_name', v_team_name, 'members', v_members);
END;
$function$;
