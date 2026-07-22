-- 617_formguard_create_team.sql
-- FORM GUARD, phase 3 of 6 — protect the unauthenticated public write endpoints.
-- This phase covers `create_team` (the squad-creation RPC behind /create, migs 015/052/212).
--
-- ⚠️ READ THIS BEFORE COPYING THE PHASE-1/2 RECIPE ANYWHERE ELSE.
-- Phases 1 and 2 (migs 615/616) put a Vercel route in front of the RPC — BotID + a per-IP
-- cap — and then revoked anon AND authenticated, so the route was the only way in. THAT
-- RECIPE IS UNSAFE FOR THIS FUNCTION, and this migration deliberately does NOT use it.
-- The reason is one branch in the function body (mig 212):
--
--     IF auth.uid() IS NOT NULL THEN
--       INSERT INTO team_admins (team_id, user_id, role, granted_by) ...auth.uid()...
--       INSERT INTO players (... user_id) VALUES (... auth.uid());
--
-- create_team READS auth.uid() to decide who owns the new squad. public_enquire_room_hire
-- and club_capture_lead read no auth at all — which is precisely why moving THEM behind a
-- service-role route was behaviour-neutral (both migrations say so explicitly). Route this
-- one the same way and the caller becomes service_role, so auth.uid() is NULL, so the
-- ownership branch is SKIPPED: no team_admins row, no self player row. The creator's brand
-- new squad never appears in My Squads and they hold nothing but the /admin/<token> URL.
-- It builds clean, it renders clean, and no deterministic gate in this repo can see it.
-- (Same failure class as the mig-070 is_self bug in Hard Rule 12: a silent auth-identity
-- drop that only a real walk would surface.)
--
-- THE GAP, AND WHY THE SIMPLE FIX IS THE RIGHT ONE. create_team is granted to PUBLIC, anon,
-- authenticated and service_role (verified against pg_proc.proacl), and — unlike the two
-- enquiry RPCs — it carries NO throttle of any kind in its body. So an unauthenticated
-- script can mint unlimited squads, each one writing a teams + schedule + settings row plus
-- a players/team_players row per name supplied. That is the hole worth closing.
--
-- But the legitimate flow is ALREADY 100% authenticated. <Onboarding> renders at exactly one
-- place, App.jsx:1347, behind `if (!authUser) return <SignIn returnTo="/create" />`, and the
-- only source caller of the RPC is useOnboarding.submitTeam. So the anon and PUBLIC grants
-- carry ZERO legitimate traffic — they are pure attack surface. Removing them is therefore
-- behaviour-neutral BY CONSTRUCTION: every real caller is `authenticated`, keeps calling the
-- RPC directly exactly as it does today, and keeps its auth.uid() ownership.
--
--   Net effect: the credential-free attack is gone outright, and the ownership path is not
--   touched at all. An attacker must now mint a real Supabase auth account per identity and
--   eat Supabase's own auth rate limits — a far higher bar than today's bare curl.
--
-- REJECTED ALTERNATIVES (recorded so phase 4-6 don't re-litigate this):
--   * Route forwards the caller's JWT so auth.uid() still resolves. Then `authenticated`
--     must KEEP execute — so the back door stays open to exactly the callers the guard is
--     meant to police, and the guard is decorative for anyone signed in.
--   * Route calls as service_role passing an explicit p_user_id, RPC does
--     COALESCE(p_user_id, auth.uid()). Works, but it adds a parameter to a SECURITY DEFINER
--     auth-bearing RPC (→ mandatory DROP FUNCTION → the re-grant trap below) AND makes squad
--     ownership a value passed in from a client-facing route. If that route's JWT check is
--     ever wrong, it is an account-impersonation primitive: create a squad owned by anyone.
--     Highest blast radius in the epic, defending against the weakest of the three threats.
--
-- WHAT THIS MIGRATION IS NOT. No Vercel route, no BotID, no rate limiter, no new bucket
-- prefix, no vercel.json change (the two BotID proxy rewrites from phase 1 stay exactly as
-- they are — this phase adds no third one). `_rate_limit_hit` and `api_rate_limits` from
-- mig 615 are untouched and unused by this phase. NO JS CHANGE AT ALL.
--
-- ⚠️ DEPLOY ORDER — NOT APPLICABLE TO THIS PHASE, and that is the point. Phases 1/2 had to
-- merge+deploy the new bundle BEFORE applying their migration, because the old bundle called
-- the RPC directly and the revoke would have broken tabs mid-session. Here the bundle does
-- not change: signed-in callers keep their grant, so an old tab and a new tab behave
-- identically. There is no gap to sequence around. (An UNauthenticated tab sitting on /create
-- cannot reach the RPC either way — it is showing the sign-in screen.)
--
-- ⚠️ HOW THIS REVOKE CAN BE SILENTLY UNDONE — both ways are real:
--
--   1. REPLAYING AN OLDER MIGRATION. 052_team_type_and_create_team_extended.sql:212 carries
--      `GRANT EXECUTE ON FUNCTION public.create_team(...) TO anon, authenticated;` on the
--      CURRENT 14-argument signature. It predates the form guard. If it is ever replayed,
--      re-apply this migration. (015:211 and 019:196 grant older, now-dropped signatures and
--      are harmless.)
--
--   2. DROP + CREATE. This DB has ALTER DEFAULT PRIVILEGES in force for schema public,
--      objtype f, from BOTH postgres and supabase_admin, granting EXECUTE to anon +
--      authenticated. Dropping and recreating create_team therefore re-grants anon with NO
--      GRANT statement anywhere in the migration. Not hypothetical: CLAUDE.md § RPC PARAMETER
--      TYPE CHANGES *mandates* an explicit DROP FUNCTION for any parameter-type change, and
--      mig 030 already dropped one create_team variant for exactly that reason. Any future
--      signature change to this function MUST re-run this REVOKE in the same migration.
--      (The trap recorded in feedback_default_privileges_revoke.)
--
--   3. CREATE OR REPLACE alone is SAFE — Postgres preserves the existing ACL. Mig 212 was a
--      CREATE OR REPLACE, which is why the 052 grant is still the live one.
--
-- FUNCTION BODY NOT TOUCHED. Grants only: no CREATE OR REPLACE, no new overload, no
-- return-shape change, no JS mapper impact (Hard Rules 7/12). NO BACKFILL / NO DATA CHANGE.

BEGIN;

-- ── THE BACK-DOOR LOCK ───────────────────────────────────────────────────────
-- create_team may no longer be called by an unauthenticated client. `authenticated` KEEPS
-- EXECUTE deliberately — it is the role every real caller already holds, and the one that
-- makes the auth.uid() ownership branch work. service_role and postgres are unaffected.
--
-- PUBLIC is revoked alongside anon and is NOT belt-and-braces here: pg_proc.proacl shows a
-- live `=X/postgres` entry, i.e. PUBLIC genuinely holds EXECUTE on this function (mig 019
-- revoked PUBLIC from an older signature that mig 052 then superseded). Revoking anon alone
-- would leave the door open to every role, including anon.
REVOKE EXECUTE ON FUNCTION public.create_team(
  text, text, text, text, integer, text, text, numeric, boolean, text[],
  text, text, integer, text
) FROM PUBLIC, anon;

-- Refresh PostgREST's cache so the revoked grant takes effect promptly.
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
