-- DOWN for migration 183 — Venue Payments Ledger V3.1.
-- Drops the two new write RPCs. The additive `payment_link` key on
-- venue_update_booking_settings + venue_get_state is harmless to leave in place
-- (a venue with no payment_link returns null), so the rebuilt functions are not
-- reverted here; to fully revert them re-apply their pre-183 bodies (captured in
-- the session-64 audit; venue_update_booking_settings mig 150/177 line, venue_get_state mig 168).

DROP FUNCTION IF EXISTS public.venue_add_fixture_charge(text, uuid, text, integer);
DROP FUNCTION IF EXISTS public.venue_void_charge(text, uuid);
