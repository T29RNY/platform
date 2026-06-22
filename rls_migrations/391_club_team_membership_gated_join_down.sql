-- Down-migration for 391 — drop the Phase 3 membership-gated join RPCs.
DROP FUNCTION IF EXISTS public.member_join_club_team(text, uuid);
DROP FUNCTION IF EXISTS public.club_team_join_context(text);
