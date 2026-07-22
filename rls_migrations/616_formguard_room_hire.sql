-- 616_formguard_room_hire.sql
-- FORM GUARD, phase 2 of 6 — protect the unauthenticated public write endpoints.
-- This migration covers `public_enquire_room_hire` (the anon "Hire a space" enquiry form on
-- VenueLanding, mig 342). Phase 1 (mig 615) did `club_capture_lead` and built the shared
-- machinery; this phase reuses that machinery UNCHANGED and adds only the back-door lock.
--
-- THE GAP. `public_enquire_room_hire` is callable by `anon` with no secret: a public space_id
-- + attacker-supplied PII. It writes a venue_room_hires row AND queues an email to the venue
-- (mig 342; that queue only actually drains since mig 613). So an unauthenticated script can
-- flood the operator's bookings board and inbox and burn Resend quota. The RPC's own throttle
-- — at most 3 enquiries per EMAIL per space per 10 minutes — is NOT flood control, because the
-- attacker chooses the email: rotating it resets the counter every request. Same conclusion
-- mig 596 reached for club_capture_lead, and the same answer: move the guard OUT of the DB.
--
-- THE SHAPE. Protection sits in front of the RPC, at a Vercel function
-- (apps/inorout/api/room-hire-enquiry.js) that runs Vercel BotID (invisible CAPTCHA) + a
-- per-IP volume cap, then calls the RPC with the service role. Phase 1 already shipped both
-- halves of that machinery, so this migration is ONE thing only:
--
--   THE BACK-DOOR LOCK. REVOKE EXECUTE on public_enquire_room_hire from anon + authenticated.
--   Without this the guard is decorative — an attacker just skips the form and calls the RPC
--   directly from the browser, exactly as the app did until this commit. After this, the ONLY
--   caller is the service role, i.e. the protected route.
--
-- REUSED, NOT REBUILT. `_rate_limit_hit` and `api_rate_limits` (mig 615) are untouched — the
-- route passes its own bucket prefix ('room_hire:') so the two endpoints cannot consume each
-- other's allowance. No new limiter, no second ledger.
--
-- SERVICE-ROLE CALL IS BEHAVIOUR-NEUTRAL. The function body reads no auth.uid() and hardcodes
-- booker_type 'non_member', so nothing depends on which role invokes it. This changes who may
-- call it, not what it does.
--
-- NOT A DoS PRIMITIVE (the mig-596 trap, deliberately avoided). The route's bucket is per-IP,
-- i.e. per-CALLER — NOT per-space or per-venue. An attacker can only rate-limit THEMSELVES;
-- they cannot switch a victim venue's enquiry form off.
--
-- ⚠️ DEPLOY ORDER — MERGE + DEPLOY FIRST, THEN APPLY THIS. The reverse order breaks every
-- browser tab still running the old bundle: it would still be calling the RPC directly, and
-- the revoke would make those calls fail silently. Deploy the route first; it works against
-- the still-granted RPC, and this migration then only closes the door behind it.
--
-- ⚠️ RE-RUNNING MIG 613 OR ITS DOWN FILE RE-GRANTS THIS. Both contain
-- `GRANT EXECUTE ... TO anon, authenticated` for this function (they predate the form guard).
-- If either is ever replayed, re-apply this migration afterwards. A CREATE OR REPLACE of the
-- function body alone does NOT re-grant — Postgres preserves the ACL — so only an explicit
-- GRANT statement can reopen the back door.
--
-- FUNCTION BODY NOT TOUCHED. Grants only: no CREATE OR REPLACE, no new overload, no
-- return-shape change, no JS mapper impact (Hard Rules 7/12).
-- NO BACKFILL / NO DATA CHANGE.

BEGIN;

-- ── THE BACK-DOOR LOCK ───────────────────────────────────────────────────────
-- public_enquire_room_hire may no longer be called straight from a browser. The protected
-- Vercel route (BotID + volume cap) calls it as service_role, which retains EXECUTE.
REVOKE EXECUTE ON FUNCTION public.public_enquire_room_hire(uuid, text, text, text, timestamptz, timestamptz, text, integer)
  FROM anon, authenticated;

-- Refresh PostgREST's cache so the revoked grant takes effect promptly.
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
