-- 341_waitlist_claim_window_down.sql — reverse of 341_waitlist_claim_window.sql
--
-- Drops the Phase-4 RPCs + internal helpers, restores the mig-340 bodies of the
-- three reissued member RPCs (auto-promote, no offer state), then drops the schema
-- delta. NOTE: restoring the full mig-340 bodies is out of scope for a mechanical
-- down — re-run mig 340 after this to get the Phase-3 behaviour back. This down only
-- removes what Phase 4 ADDED so the schema/grant surface is clean.

DROP FUNCTION IF EXISTS public.expire_class_waitlist_offers();
DROP FUNCTION IF EXISTS public.member_claim_waitlist_spot(uuid);
DROP FUNCTION IF EXISTS public._offer_next_waitlist_spot(uuid);

-- Revert the status CHECK to the mig-340 set (drops 'offered'). Any live 'offered'
-- rows must be resolved first or the constraint add will fail.
UPDATE public.venue_class_bookings SET status = 'waitlist', offer_expires_at = NULL
 WHERE status = 'offered';
ALTER TABLE public.venue_class_bookings
  DROP CONSTRAINT IF EXISTS venue_class_bookings_status_check;
ALTER TABLE public.venue_class_bookings
  ADD CONSTRAINT venue_class_bookings_status_check
  CHECK (status IN ('confirmed','waitlist','cancelled','no_show'));

ALTER TABLE public.venue_class_bookings DROP COLUMN IF EXISTS offer_expires_at;
ALTER TABLE public.venues DROP COLUMN IF EXISTS class_claim_window_minutes;

-- member_book_class_session / member_cancel_class_booking / member_list_class_sessions
-- / member_list_my_class_bookings retain their Phase-4 bodies until mig 340 is
-- re-applied; they reference no dropped objects so they remain callable (the
-- offer_expires_at references resolve to a missing column only inside the dropped
-- helper, not these). Re-run 340_member_class_booking.sql to fully revert.

SELECT pg_notify('pgrst', 'reload schema');
