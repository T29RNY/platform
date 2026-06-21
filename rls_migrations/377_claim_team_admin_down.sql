-- 377_claim_team_admin_down
DROP FUNCTION IF EXISTS public.claim_team_admin(text);
DROP INDEX IF EXISTS public.team_admins_team_user_active_uniq;
