-- 238_superadmin_list_teams_activation_down.sql — revert: drop activation_stage + last_active.
CREATE OR REPLACE FUNCTION public.superadmin_list_teams()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'team_id', t.id, 'name', t.name, 'admin_email', t.admin_email, 'join_code', t.join_code,
      'onboarding_complete', t.onboarding_complete, 'created_at', t.created_at,
      'player_count', (SELECT count(*) FROM team_players WHERE team_id = t.id),
      'admin_count', (SELECT count(*) FROM team_admins WHERE team_id = t.id AND revoked_at IS NULL),
      'last_match_date', (SELECT max(match_date) FROM matches WHERE team_id = t.id),
      'outstanding_total', COALESCE((SELECT SUM(p.owes) FROM team_players tp JOIN players p ON p.id = tp.player_id WHERE tp.team_id = t.id AND p.owes > 0), 0),
      'admin_emails', COALESCE((SELECT jsonb_agg(u.email) FROM team_admins ta JOIN auth.users u ON u.id = ta.user_id WHERE ta.team_id = t.id AND ta.revoked_at IS NULL), '[]'::jsonb)
    ) AS row FROM teams t ORDER BY t.created_at DESC
  ) q;
  RETURN v_rows;
END;
$function$;
