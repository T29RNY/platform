-- 617_formguard_create_team_down.sql
-- Reverses 617_formguard_create_team.sql — restores the pre-form-guard grants on
-- create_team, i.e. re-opens it to unauthenticated callers.
--
-- ⚠️ THIS RE-OPENS THE HOLE. After this runs, any unauthenticated client can call
-- create_team again and mint unlimited squads with no throttle. Only run it if the revoke
-- itself is shown to have broken something — and note that it should not be able to, since
-- every real caller is `authenticated` (whose grant 617 never touched) and the app bundle
-- is unchanged by that phase.
--
-- Restores the exact pre-617 ACL as read from pg_proc.proacl before the apply:
--   =X/postgres  (PUBLIC)  ·  anon=X/postgres  ·  authenticated=X/postgres  ·  service_role=X/postgres
-- authenticated and service_role were never revoked, so they are not re-granted here.

BEGIN;

GRANT EXECUTE ON FUNCTION public.create_team(
  text, text, text, text, integer, text, text, numeric, boolean, text[],
  text, text, integer, text
) TO PUBLIC, anon;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
