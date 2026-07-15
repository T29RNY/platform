-- 577_venue_list_members_pii_gate_down.sql
--
-- Reverts 577: restores the pre-gate venue_list_members body from mig 410
-- (email / dob / guardians returned to ANY resolved venue caller — the leak).
-- Down-only; re-opens the PII exposure, so this is a rollback aid, not a state to
-- leave live. Signature unchanged; pure CREATE OR REPLACE.

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
    'email', COALESCE(c.email, mp.email), 'dob', COALESCE(mp.dob, c.dob), 'tier_id', t.id, 'tier_name', t.name,
    'guardians', CASE WHEN m.member_profile_id IS NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'profile_id', g.id,
        'name', TRIM(BOTH ' ' FROM COALESCE(g.first_name,'') || ' ' || COALESCE(g.last_name,'')),
        'email', g.email, 'phone', g.phone,
        'relationship', mg.relationship, 'is_primary', mg.is_primary,
        'can_collect', mg.can_collect, 'invite_state', mg.invite_state
      ) ORDER BY mg.is_primary DESC, g.first_name)
      FROM public.member_guardians mg
      JOIN public.member_profiles g ON g.id = mg.guardian_profile_id
      WHERE mg.child_profile_id = m.member_profile_id
    ), '[]'::jsonb) END
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
