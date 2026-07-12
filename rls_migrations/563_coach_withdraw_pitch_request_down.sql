-- 563_coach_withdraw_pitch_request_down.sql
-- Revert: drop the withdraw RPC. Additive new function, no dependents (the wrapper +
-- UI ship in the same PR and no other RPC calls it), so a plain DROP is clean.
DROP FUNCTION IF EXISTS public.club_manager_withdraw_pitch_request(uuid);
SELECT pg_notify('pgrst', 'reload schema');
