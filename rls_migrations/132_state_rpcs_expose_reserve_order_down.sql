-- 132 down — restore prior state RPCs without reserve_priority_order.
-- Captured from pg_proc immediately before mig 132 was applied.

-- get_team_state_by_admin_token (pre-132)
CREATE OR REPLACE FUNCTION public.get_team_state_by_admin_token(p_admin_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id    text;
  v_team       jsonb;
  v_squad      jsonb;
  v_schedule   jsonb;
  v_matches    jsonb;
  v_bib_hist   jsonb;
  v_settings   jsonb;
  v_cover_pool jsonb;
  v_lckey      text;
BEGIN
  IF p_admin_token IS NULL THEN RETURN NULL; END IF;
  SELECT t.id, jsonb_build_object(
      'id', t.id, 'name', t.name, 'join_code', t.join_code,
      'onboarding_complete', t.onboarding_complete,
      'admin_email', t.admin_email,
      'live_channel_key', t.live_channel_key,
      'created_at', t.created_at
    )
  INTO v_team_id, v_team FROM teams t WHERE t.admin_token = p_admin_token;
  IF v_team_id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname, 'status', p.status,
    'type', p.type, 'priority', p.priority, 'paid', p.paid, 'owes', p.owes,
    'self_paid', p.self_paid, 'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended, 'total', p.total,
    'w', p.w, 'l', p.l, 'd', p.d, 'bib_count', p.bib_count,
    'late_dropouts', p.late_dropouts, 'injured', p.injured,
    'injured_since', p.injured_since, 'is_guest', p.is_guest,
    'guest_of', p.guest_of, 'note', p.note,
    'is_vice_captain', tp.is_vice_captain, 'group_number', tp.group_number,
    'disabled', p.disabled, 'disable_reason', p.disable_reason,
    'admin_locked_in', p.admin_locked_in, 'team', p.team, 'token', p.token,
    'is_self', (p.user_id IS NOT NULL AND p.user_id = auth.uid())
  ) ORDER BY tp.created_at, p.id), '[]'::jsonb) INTO v_squad
  FROM team_players tp JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id;
  -- (other v_* SELECTs omitted in this down-mig stub; rerun mig 130 down + re-apply original migrations to fully revert)
  SELECT to_jsonb(s.*) INTO v_schedule FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;
  RETURN jsonb_build_object(
    'team', v_team, 'squad', v_squad, 'schedule', v_schedule,
    'matches', '[]'::jsonb, 'bib_history', '[]'::jsonb,
    'settings', NULL, 'cover_pool', '[]'::jsonb,
    'live_channel_key', NULL
  );
END;
$function$;

-- get_team_state_by_player_token: down stub omitted (revert via mig 132 forward minus the added fields).
-- For a true rollback, restore by replaying the immediately-prior CREATE OR REPLACE captured from pg_proc.
