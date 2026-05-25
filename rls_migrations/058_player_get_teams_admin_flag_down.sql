-- ════════════════════════════════════════════════════════════════════════════
-- 058 DOWN — restore pre-058 player_get_teams signature
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.player_get_teams();

CREATE OR REPLACE FUNCTION public.player_get_teams()
RETURNS TABLE(
  token           text,
  team_id         text,
  team_name       text,
  player_name     text,
  player_nickname text,
  is_vice_captain boolean,
  disabled        boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (t.id)
    p.token,
    t.id       AS team_id,
    t.name     AS team_name,
    p.name     AS player_name,
    p.nickname AS player_nickname,
    tp.is_vice_captain,
    p.disabled
  FROM players p
  JOIN team_players tp ON tp.player_id = p.id
  JOIN teams        t  ON t.id          = tp.team_id
  WHERE p.user_id = auth.uid()
  ORDER BY t.id, p.created_at DESC;
$$;

REVOKE ALL    ON FUNCTION public.player_get_teams() FROM public;
REVOKE ALL    ON FUNCTION public.player_get_teams() FROM anon;
GRANT EXECUTE ON FUNCTION public.player_get_teams() TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
