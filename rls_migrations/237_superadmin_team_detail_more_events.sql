-- 237_superadmin_team_detail_more_events.sql
-- Bump superadmin_team_detail's recent_events cap 20 → 200 so the Team Detail view's
-- new time-period + event-type filters have enough history to work over. Read-only,
-- is_platform_admin() gated; only the events subquery LIMIT changed. Full body re-stated
-- for CREATE OR REPLACE (PostgreSQL replaces the whole definition).

CREATE OR REPLACE FUNCTION public.superadmin_team_detail(p_team_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team     jsonb;
  v_schedule jsonb;
  v_squad    jsonb;
  v_matches  jsonb;
  v_payments jsonb;
  v_admins   jsonb;
  v_events   jsonb;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT to_jsonb(t) INTO v_team FROM teams t WHERE id = p_team_id;
  IF v_team IS NULL THEN
    RAISE EXCEPTION 'team_not_found';
  END IF;

  SELECT to_jsonb(s) INTO v_schedule
  FROM schedule s WHERE s.team_id = p_team_id AND s.active = true LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id',  p.id, 'name', p.name, 'status', p.status, 'type', p.type, 'team', p.team,
    'disabled', p.disabled, 'is_guest', p.is_guest, 'token', p.token, 'user_id', p.user_id,
    'attended', p.attended, 'total', p.total, 'goals', p.goals, 'motm', p.motm,
    'bib_count', p.bib_count, 'priority', p.priority, 'paid', p.paid, 'owes', p.owes
  ) ORDER BY p.name), '[]'::jsonb) INTO v_squad
  FROM team_players tp JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = p_team_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'match_id', m.id, 'match_date', m.match_date, 'cancelled', m.cancelled,
    'score_a', m.score_a, 'score_b', m.score_b, 'winner', m.winner,
    'team_a', m.team_a, 'team_b', m.team_b, 'created_at', m.created_at
  ) ORDER BY m.match_date DESC NULLS LAST), '[]'::jsonb) INTO v_matches
  FROM (SELECT * FROM matches WHERE team_id = p_team_id ORDER BY match_date DESC NULLS LAST LIMIT 10) m;

  SELECT jsonb_build_object(
    'outstanding_total', COALESCE((SELECT SUM(p.owes) FROM team_players tp JOIN players p ON p.id = tp.player_id WHERE tp.team_id = p_team_id AND p.owes > 0), 0),
    'unpaid_count', COALESCE((SELECT COUNT(*) FROM team_players tp JOIN players p ON p.id = tp.player_id WHERE tp.team_id = p_team_id AND p.owes > 0), 0),
    'paid_last_30d', COALESCE((SELECT SUM(amount) FROM payment_ledger WHERE team_id = p_team_id AND status = 'paid' AND type = 'game_fee' AND created_at >= now() - interval '30 days'), 0),
    'ledger_size', COALESCE((SELECT COUNT(*) FROM payment_ledger WHERE team_id = p_team_id), 0)
  ) INTO v_payments;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', ta.user_id, 'email', u.email, 'role', ta.role,
    'granted_at', ta.granted_at, 'revoked_at', ta.revoked_at, 'last_sign_in_at', u.last_sign_in_at
  ) ORDER BY ta.granted_at), '[]'::jsonb) INTO v_admins
  FROM team_admins ta JOIN auth.users u ON u.id = ta.user_id
  WHERE ta.team_id = p_team_id AND ta.revoked_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ae.id, 'actor_type', ae.actor_type, 'actor_email', u.email, 'action', ae.action,
    'entity_type', ae.entity_type, 'entity_id', ae.entity_id, 'metadata', ae.metadata, 'created_at', ae.created_at
  ) ORDER BY ae.created_at DESC), '[]'::jsonb) INTO v_events
  FROM (SELECT * FROM audit_events WHERE team_id = p_team_id ORDER BY created_at DESC LIMIT 200) ae
  LEFT JOIN auth.users u ON u.id = ae.actor_user_id;

  RETURN jsonb_build_object(
    'team', v_team, 'schedule', v_schedule, 'squad', v_squad, 'matches', v_matches,
    'payments', v_payments, 'admins', v_admins, 'recent_events', v_events
  );
END;
$function$;
