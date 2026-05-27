-- 121_phase3_ref_venue_broadcasts_down.sql
-- Reverts the venue broadcast addition: drops notify_venue_change +
-- _ref_venue_id_for_fixture helpers. The 7 ref RPCs are NOT reverted to
-- their mig-120 bodies by this down — they keep the venue-broadcast call
-- which becomes a no-op once notify_venue_change is gone (PERFORM still
-- raises; you'd need to re-apply mig 120 to fully revert ref RPC bodies).

DROP FUNCTION IF EXISTS public.notify_venue_change(text, text);
DROP FUNCTION IF EXISTS public._ref_venue_id_for_fixture(public.fixtures);
