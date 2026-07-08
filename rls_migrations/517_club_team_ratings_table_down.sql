-- 517 DOWN: drop the club team ratings/reliability reader. Read-only, no schema/data
-- change to undo (no tables created).
DROP FUNCTION IF EXISTS public.club_manager_get_team_ratings_table(uuid);
SELECT pg_notify('pgrst','reload schema');
