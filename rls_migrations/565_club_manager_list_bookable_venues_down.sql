-- 565 DOWN: drop the manager-gated bookable-venues reader (additive, no dependents — the
-- wrapper + UI ship in the same PR and no other RPC calls it).
DROP FUNCTION IF EXISTS public.club_manager_list_bookable_venues(uuid);
SELECT pg_notify('pgrst', 'reload schema');
