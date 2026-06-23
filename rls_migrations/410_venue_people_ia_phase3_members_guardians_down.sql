-- 410_venue_people_ia_phase3_members_guardians_down.sql
--
-- Reverts venue_list_members to its pre-Phase-3 shape (drops the `dob` field and the
-- `guardians` array). The Members page would then render members without guardian
-- columns, but won't error (the client reads guardians defensively).

CREATE OR REPLACE FUNCTION public.venue_list_members(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', m.id, 'status', m.status, 'period', m.period, 'amount_pence', m.amount_pence,
    'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until, 'cancel_at', m.cancel_at,
    'due_soon', (m.status='active' AND m.renews_at <= current_date + 7),
    'pass_token', m.pass_token, 'customer_id', m.customer_id, 'member_profile_id', m.member_profile_id,
    'club_id', m.club_id, 'discipline', cl.discipline,
    'first_name', COALESCE(c.first_name, mp.first_name), 'last_name', COALESCE(c.last_name, mp.last_name),
    'email', COALESCE(c.email, mp.email), 'tier_id', t.id, 'tier_name', t.name
  ) ORDER BY m.status, COALESCE(c.first_name, mp.first_name)), '[]'::jsonb) INTO v_rows
  FROM public.venue_memberships m
  LEFT JOIN public.venue_customers c ON c.id=m.customer_id
  LEFT JOIN public.member_profiles mp ON mp.id=m.member_profile_id
  LEFT JOIN public.clubs cl ON cl.id=m.club_id
  JOIN public.venue_membership_tiers t ON t.id=m.tier_id
  WHERE m.status<>'cancelled'
    AND (m.venue_id=v_venue_id OR (m.club_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.club_venues WHERE club_id=m.club_id AND venue_id=v_venue_id)));
  RETURN jsonb_build_object('ok', true, 'members', v_rows);
END; $function$;

REVOKE ALL ON FUNCTION public.venue_list_members(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_members(text) TO anon, authenticated;
