-- 547 DOWN: restore club_manager_team_payments to its pre-547 body (membership charges only,
-- unpaid_amount = sum(amount_due_pence) ignoring payments). Shape unchanged, so no client impact.

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
      SELECT count(*) FILTER (WHERE ch2.status IN ('unpaid','partial')) AS unpaid_count,
             sum(ch2.amount_due_pence) FILTER (WHERE ch2.status IN ('unpaid','partial')) AS unpaid_amount,
             count(*) FILTER (WHERE ch2.status IN ('unpaid','partial') AND ch2.due_date <= current_date) AS overdue_count
      FROM public.venue_charges ch2
      WHERE ch2.source_type = 'membership' AND m.id IS NOT NULL
        AND split_part(ch2.source_id, ':', 1)::uuid = m.id
    ) ch ON true
    WHERE ctm.team_id = p_team_id AND ctm.is_active = true
  ) s;

  RETURN jsonb_build_object('ok', true, 'team_name', v_team_name, 'members', v_members);
END;
$function$;
