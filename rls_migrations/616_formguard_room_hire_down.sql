-- 616_formguard_room_hire_down.sql
-- Reverts 616. Restores direct browser access to public_enquire_room_hire (the pre-616,
-- unprotected ACL from mig 613).
--
-- ⚠️ Running this re-opens the unauthenticated flood surface on the public "Hire a space"
-- enquiry form. Only run it if the protected route (apps/inorout/api/room-hire-enquiry.js) is
-- also being reverted — otherwise the client wrapper still posts to /api/room-hire-enquiry
-- and the RPC is simply reachable again, unguarded, alongside it.
--
-- Deliberately does NOT touch _rate_limit_hit or api_rate_limits: those are phase 1's (mig
-- 615), still in use by /api/club-lead, and dropping them here would break that endpoint.
-- Reverting the shared machinery is 615_formguard_club_lead_down.sql's job.

BEGIN;

-- Re-grant direct execute to the client roles (the mig-613 ACL).
GRANT EXECUTE ON FUNCTION public.public_enquire_room_hire(uuid, text, text, text, timestamptz, timestamptz, text, integer)
  TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
