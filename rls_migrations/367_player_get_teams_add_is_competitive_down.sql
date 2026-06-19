-- 367 DOWN — revert player_get_teams to the pre-is_competitive (8-column) shape.
DROP FUNCTION IF EXISTS public.player_get_teams();

CREATE FUNCTION public.player_get_teams()
 RETURNS TABLE(token text, team_id text, team_name text, player_name text, player_nickname text, is_vice_captain boolean, is_team_admin boolean, disabled boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (t.id)
    p.token,
    t.id          AS team_id,
    t.name        AS team_name,
    p.name        AS player_name,
    p.nickname    AS player_nickname,
    tp.is_vice_captain,
    (ta.user_id IS NOT NULL) AS is_team_admin,
    p.disabled
  FROM players p
  JOIN team_players tp ON tp.player_id = p.id
  JOIN teams        t  ON t.id          = tp.team_id
  LEFT JOIN team_admins ta
    ON ta.team_id    = t.id
   AND ta.user_id    = auth.uid()
   AND ta.revoked_at IS NULL
  WHERE p.user_id = auth.uid()
  ORDER BY t.id, p.created_at DESC;
$function$;

REVOKE ALL    ON FUNCTION public.player_get_teams() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.player_get_teams() FROM anon;
GRANT  EXECUTE ON FUNCTION public.player_get_teams() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.player_get_teams() TO service_role;
