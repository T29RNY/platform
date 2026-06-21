-- 376_get_my_admin_teams
-- Phase: Unified Login (Step 1 — account → admin bridge).
-- For the signed-in account, return every team they are a VERIFIED admin of,
-- WITH that team's admin_token, so the account-based landing can open the admin
-- view without the user pasting the secret /admin/<token> URL. Only ever returns
-- a token to a caller already recorded as that team's admin
-- (team_admins.user_id = auth.uid(), not revoked) — i.e. someone who already
-- holds admin rights. Read-only. authenticated-only (anon revoked).
CREATE OR REPLACE FUNCTION public.get_my_admin_teams()
RETURNS TABLE(team_id text, team_name text, admin_token text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.id, t.name, t.admin_token
  FROM team_admins ta
  JOIN teams t ON t.id = ta.team_id
  WHERE ta.user_id = auth.uid()
    AND ta.revoked_at IS NULL
  ORDER BY t.name;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_teams() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_admin_teams() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_teams() TO authenticated;
