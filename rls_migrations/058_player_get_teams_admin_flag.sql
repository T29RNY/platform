-- ════════════════════════════════════════════════════════════════════════════
-- 058 — player_get_teams: add is_team_admin flag
-- ════════════════════════════════════════════════════════════════════════════
-- Surfaces whether the authenticated user holds an active team_admins row
-- for each squad returned. Used by the MySquads accordion to render the
-- ADMIN badge for both real team_admins AND vice captains (VC = co-admin
-- per current product copy).
--
-- Pre-058 the RPC only returned is_vice_captain, so the team creator (who
-- is in team_admins but is_vice_captain=false) never got the ADMIN badge —
-- on team_KPaoX8oJYMQ this meant the VC Tarny saw himself listed as admin
-- but not the actual creator rockybram.
--
-- RETURNS TABLE change requires DROP-then-CREATE (CREATE OR REPLACE cannot
-- alter the return shape). No other DB object depends on this function.
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
  is_team_admin   boolean,
  disabled        boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (t.id)
    p.token,
    t.id                        AS team_id,
    t.name                      AS team_name,
    p.name                      AS player_name,
    p.nickname                  AS player_nickname,
    tp.is_vice_captain,
    (ta.user_id IS NOT NULL)    AS is_team_admin,
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
$$;

REVOKE ALL    ON FUNCTION public.player_get_teams() FROM public;
REVOKE ALL    ON FUNCTION public.player_get_teams() FROM anon;
GRANT EXECUTE ON FUNCTION public.player_get_teams() TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
