-- Down for migration 181 — Venue Payments Ledger V2.
-- Drops the new payment RPCs + helper. The three hooked RPCs
-- (venue_confirm_booking, venue_generate_fixtures, venue_update_fixture_status)
-- and notify_venue_change are NOT auto-reverted here — restore them from mig 180-era
-- live bodies if a full rollback is required (they remain functional with the V2
-- charge logic still present; the dropped tables/charges are what break it).
-- For a clean revert, run this AND restore those four functions from their prior defs.

DROP FUNCTION IF EXISTS public.venue_set_charge_due(text, uuid, int);
DROP FUNCTION IF EXISTS public.venue_get_charges(text, text, text, int);
DROP FUNCTION IF EXISTS public.venue_void_payment(text, uuid);
DROP FUNCTION IF EXISTS public.venue_record_payment(text, uuid, int, text, text, text);
DROP FUNCTION IF EXISTS public._recompute_charge_status(uuid);
