-- 578_superadmin_create_club_down.sql
-- Reverses 578_superadmin_create_club.sql. Drops the function only — the venues
-- columns it reuses (verification_status/origin/created_by_user) are owned by
-- migs 484/518 and are NOT dropped here. Any clubs/venues already minted by the
-- writer are left in place (dropping the function does not un-provision real
-- clubs). Explicit signature so a future param-type change can't leave a stale
-- overload behind (RPC PARAMETER TYPE CHANGES rule).
DROP FUNCTION IF EXISTS public.superadmin_create_club(text, text, text, text);
