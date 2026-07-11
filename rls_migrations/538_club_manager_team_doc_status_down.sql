-- 538_club_manager_team_doc_status_down.sql — drop the P10a coach doc-status reader.
DROP FUNCTION IF EXISTS public.club_manager_get_team_doc_status(uuid);
