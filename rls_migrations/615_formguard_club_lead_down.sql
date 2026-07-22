-- 615_formguard_club_lead_down.sql
-- Reverts 615. Restores direct browser access to club_capture_lead (the pre-615,
-- unprotected state) and removes the rate-limit ledger + limiter.
--
-- ⚠️ Running this re-opens the unauthenticated flood surface on the LIVE DF trial CTA.
-- Only run it if the protected route (apps/inorout/api/club-lead.js) is also being
-- reverted — otherwise the form breaks (the client wrapper calls /api/club-lead, and
-- the RPC would be reachable again but unguarded).

BEGIN;

-- 1. Re-grant direct execute to the client roles (pre-615 ACL).
GRANT EXECUTE ON FUNCTION public.club_capture_lead(text, text, text, text, text, date)
  TO anon, authenticated;

-- 2. Drop the limiter + its ledger.
DROP FUNCTION IF EXISTS public._rate_limit_hit(text, integer, integer);
DROP TABLE IF EXISTS public.api_rate_limits;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
