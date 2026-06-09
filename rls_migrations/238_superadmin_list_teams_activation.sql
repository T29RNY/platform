-- 238_superadmin_list_teams_activation.sql
-- Add two fields to superadmin_list_teams for the Teams tab's onboarding-status column +
-- first-2-weeks quiet alert:
--   activation_stage — furthest funnel milestone (0 created → 1 week opened → 2 players
--                      responded → 3 teams picked → 4 result recorded), from audit_events.
--   last_active      — max(audit_events.created_at); the view derives "quiet" + "new".
-- Read-only, is_platform_admin() gated. Full body re-stated for CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.superadmin_list_teams()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'team_id',             t.id,
      'name',                t.name,
      'admin_email',         t.admin_email,
      'join_code',           t.join_code,
      'onboarding_complete', t.onboarding_complete,
      'created_at',          t.created_at,
      'player_count',        (SELECT count(*) FROM team_players WHERE team_id = t.id),
      'admin_count',         (SELECT count(*) FROM team_admins WHERE team_id = t.id AND revoked_at IS NULL),
      'last_match_date',     (SELECT max(match_date) FROM matches WHERE team_id = t.id),
      'activation_stage',    (SELECT CASE
                                 WHEN bool_or(action = 'match_result_saved') THEN 4
                                 WHEN bool_or(action IN ('match_teams_saved','match_teams_confirmed')) THEN 3
                                 WHEN bool_or(action = 'player_status_set') THEN 2
                                 WHEN bool_or(action = 'week_opened') THEN 1
                                 ELSE 0 END
                              FROM audit_events WHERE team_id = t.id),
      'last_active',         (SELECT max(created_at) FROM audit_events WHERE team_id = t.id),
      'outstanding_total',   COALESCE((
        SELECT SUM(p.owes) FROM team_players tp JOIN players p ON p.id = tp.player_id
        WHERE tp.team_id = t.id AND p.owes > 0), 0),
      'admin_emails',        COALESCE((
        SELECT jsonb_agg(u.email) FROM team_admins ta JOIN auth.users u ON u.id = ta.user_id
        WHERE ta.team_id = t.id AND ta.revoked_at IS NULL), '[]'::jsonb)
    ) AS row
    FROM teams t
    ORDER BY t.created_at DESC
  ) q;

  RETURN v_rows;
END;
$function$;
