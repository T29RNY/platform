-- 601_coach_list_upcoming_sessions_down.sql
-- Reverses 601_coach_list_upcoming_sessions.sql.
DROP FUNCTION IF EXISTS public.club_manager_list_upcoming_sessions(text, uuid);
