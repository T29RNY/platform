-- 618_app_sessions_down.sql — reverse of 618_app_sessions.sql

DROP FUNCTION IF EXISTS public.superadmin_recent_sessions(int, timestamptz);
DROP FUNCTION IF EXISTS public.log_session_ping(text, text, text, text, text, text, text, text, text, text);
DROP TABLE IF EXISTS public.app_sessions;

SELECT pg_notify('pgrst', 'reload schema');
