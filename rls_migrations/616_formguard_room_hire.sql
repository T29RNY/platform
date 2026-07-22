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
-- the revoke would make those calls fail. The user sees "Couldn't send that" (the wrapper
-- throws) — so it is not silent to THEM, but the enquiry is lost with no operator-side trace.
-- Deploy the route first; it works against the still-granted RPC, and this migration then
-- only closes the door behind it.
--
-- ⚠️ HOW THIS REVOKE CAN BE SILENTLY UNDONE — three ways, all real:
--
--   1. REPLAYING AN OLDER MIGRATION. THREE files still carry
--      `GRANT EXECUTE ... TO anon, authenticated` for this function (they predate the form
--      guard): 342_room_hire.sql:213, 613_notification_drain_sent_at.sql:184, and
--      613_notification_drain_sent_at_down.sql:145. If any is replayed, re-apply this.
--
--   2. DROP + CREATE — the dangerous one. This DB has ALTER DEFAULT PRIVILEGES in force for
--      schema public, objtype f, from BOTH postgres and supabase_admin, granting EXECUTE to
--      anon + authenticated (verified against pg_default_acl). So dropping and recreating the
--      function re-grants both roles with NO GRANT statement anywhere in the migration. This
--      is NOT hypothetical: CLAUDE.md § RPC PARAMETER TYPE CHANGES *mandates* an explicit
--      DROP FUNCTION for any parameter-type change. Any future signature change to this
--      function MUST re-run this REVOKE in the same migration.
--      (This is the trap recorded in feedback_default_privileges_revoke — revoke from the
--      NAMED roles, and never assume a fresh function starts un-granted.)
--
--   3. CREATE OR REPLACE alone is SAFE — Postgres preserves the existing ACL. Only a
--      drop/recreate or an explicit GRANT reopens it.
--
-- RPCS.md records this function as service-role-only / route-guarded so a future engineer
-- hits the constraint before changing the signature (Hard Rules 8/14).
--
-- FUNCTION BODY NOT TOUCHED. Grants only: no CREATE OR REPLACE, no new overload, no
-- return-shape change, no JS mapper impact (Hard Rules 7/12).
-- NO BACKFILL / NO DATA CHANGE.

BEGIN;

-- ── THE BACK-DOOR LOCK ───────────────────────────────────────────────────────
-- public_enquire_room_hire may no longer be called straight from a browser. The protected
-- Vercel route (BotID + volume cap) calls it as service_role, which retains EXECUTE.
-- PUBLIC is included for belt-and-braces: migs 342/613 already revoked it, but a grant to
-- PUBLIC would hand EXECUTE to every role including anon, so it costs nothing to be explicit.
REVOKE EXECUTE ON FUNCTION public.public_enquire_room_hire(uuid, text, text, text, timestamptz, timestamptz, text, integer)
  FROM PUBLIC, anon, authenticated;

-- Refresh PostgREST's cache so the revoked grant takes effect promptly.
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
