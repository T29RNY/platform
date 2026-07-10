-- 527 DOWN: drop the coach-auth team join-link RPC. Safe — it's a new, isolated function
-- with no dependents; the invite_links rows it may have created remain valid (they're the
-- same shared 'join_club_team' code space the venue-token twin still manages).

DROP FUNCTION IF EXISTS public.club_manager_ensure_team_invite_link(uuid);

SELECT pg_notify('pgrst', 'reload schema');
