-- Drop admin_go_live_for_team. cron.js must be reverted to the raw
-- update-and-notify pattern before applying this down migration.
DROP FUNCTION IF EXISTS public.admin_go_live_for_team(text);

SELECT pg_notify('pgrst', 'reload schema');
