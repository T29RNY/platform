-- Down for migration 153 — restore the mig-072 signature exactly (no is_competitive,
-- search_path 'public'). DROP then CREATE because the return-type differs.

DROP FUNCTION IF EXISTS public.player_get_teams_by_token(text);

CREATE FUNCTION public.player_get_teams_by_token(p_token text)
RETURNS TABLE(
  token            text,
  team_id          text,
  team_name        text,
  player_name      text,
  player_nickname  text,
  is_vice_captain  boolean,
  is_team_admin    boolean,
  disabled         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT players.user_id INTO v_user_id
  FROM players
  WHERE players.token = p_token
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
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
  JOIN teams        t  ON t.id         = tp.team_id
  LEFT JOIN team_admins ta
    ON ta.team_id    = t.id
   AND ta.user_id    = v_user_id
   AND ta.revoked_at IS NULL
  WHERE p.user_id = v_user_id
  ORDER BY t.id, p.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.player_get_teams_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.player_get_teams_by_token(text) TO anon, authenticated;
