-- 074_resolve_admin_caller.sql
--
-- Shared resolver for every admin_* RPC. Accepts the team's
-- admin_token OR the player_token of a Vice Captain on a team,
-- returning the team_id plus audit identification fields.
--
-- Used by the migration 075 sweep so that VCs get owner-grade
-- authority across the entire admin surface without per-RPC
-- special-casing. Audit trail differentiates the caller:
--   admin_token  → actor_type='team_admin',   actor_identifier='admin_token:<md5>'
--   VC player    → actor_type='vice_captain', actor_identifier='player_token:<md5>'
--
-- The helper deliberately does NOT handle auth.uid(). That branch
-- lives only in admin_set_vice_captain, paired with a specific
-- target-disambiguating join.

CREATE OR REPLACE FUNCTION public.resolve_admin_caller(p_token text)
RETURNS TABLE(team_id text, actor_type text, actor_ident text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_token IS NULL THEN
    RETURN;
  END IF;

  -- Stage 1: admin_token of a team
  RETURN QUERY
    SELECT t.id::text,
           'team_admin'::text,
           ('admin_token:' || md5(p_token))::text
    FROM teams t
    WHERE t.admin_token = p_token
    LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Stage 2: player_token of a Vice Captain
  RETURN QUERY
    SELECT tp.team_id::text,
           'vice_captain'::text,
           ('player_token:' || md5(p_token))::text
    FROM team_players tp
    JOIN players pl ON pl.id = tp.player_id
    WHERE pl.token = p_token
      AND tp.is_vice_captain = true
    LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_admin_caller(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_admin_caller(text) TO anon, authenticated, service_role;
