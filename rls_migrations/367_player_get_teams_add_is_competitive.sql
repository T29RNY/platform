-- 367 — player_get_teams: add is_competitive (parity with player_get_teams_by_token)
--
-- Session 154 follow-up. The s154 MySquads fix switched the signed-in viewer's
-- squad list from the matchday-squad token RPC (player_get_teams_by_token) to the
-- auth-identity RPC (player_get_teams). The two had drifted: only the token RPC
-- returned is_competitive, so the purple LEAGUE pill stopped rendering for
-- signed-in users in apps/inorout/src/views/MySquads.jsx.
--
-- Fix: add is_competitive to player_get_teams, sourced IDENTICALLY to the token
-- RPC (EXISTS over competition_teams ⋈ competitions, active + type='league').
-- No MySquads.jsx change — the pill JSX already reads squad.is_competitive.
--
-- Adding an OUT column changes the function's row type, so CREATE OR REPLACE
-- cannot be used (ERROR 42P13) — DROP first. Zero-arg signature is otherwise
-- unchanged. Grants restored to the prior set: authenticated + service_role only
-- (NO anon — this RPC authenticates via auth.uid()). Note: DROP+CREATE re-triggers
-- ALTER DEFAULT PRIVILEGES which re-grants anon, hence the explicit REVOKE below.
--
-- Consumers (hard rule #14): apps/inorout MySquads.jsx (LEAGUE pill, both the
-- current-squad and other-squad render sites). Wrapper getPlayerTeams in
-- packages/core/storage/supabase.js returns data raw — no mapper to update
-- (hard rule #12 N/A).

DROP FUNCTION IF EXISTS public.player_get_teams();

CREATE FUNCTION public.player_get_teams()
 RETURNS TABLE(token text, team_id text, team_name text, player_name text, player_nickname text, is_vice_captain boolean, is_team_admin boolean, disabled boolean, is_competitive boolean)
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
    p.disabled,
    EXISTS (
      SELECT 1 FROM competition_teams ct
      JOIN competitions c ON c.id = ct.competition_id
      WHERE ct.team_id = t.id AND ct.status = 'active' AND c.type = 'league'
    ) AS is_competitive
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
