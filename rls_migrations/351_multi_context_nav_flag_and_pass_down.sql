-- Down migration 351 — remove the multi-context nav flag + pass token.
-- member_get_self is restored to its pre-351 body (no pass_token) in the same
-- way the up migration re-created it; here we just drop the new pieces and leave
-- member_get_self carrying pass_token harmlessly (additive, no consumer breaks).
DROP FUNCTION IF EXISTS public.get_team_feature_flags(text);
ALTER TABLE public.teams DROP COLUMN IF EXISTS multi_context_nav;
