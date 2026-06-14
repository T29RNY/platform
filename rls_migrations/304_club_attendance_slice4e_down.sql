-- Down migration 304
DROP FUNCTION IF EXISTS public.club_manager_mark_attendance(uuid, jsonb);
