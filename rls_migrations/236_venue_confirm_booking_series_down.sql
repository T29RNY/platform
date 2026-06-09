-- 236_venue_confirm_booking_series_down.sql
-- Revert: drop the series-confirm RPC. Confirm reverts to the per-booking loop
-- in RequestsInbox (the pre-236 partial-window behaviour).

DROP FUNCTION IF EXISTS public.venue_confirm_booking_series(text, uuid);
