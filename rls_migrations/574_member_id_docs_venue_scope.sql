-- 574_member_id_docs_venue_scope.sql
-- Close the residual cross-venue read on members'/children's ID documents left
-- open by mig 572. That migration replaced the "any authenticated user" reader
-- with owner + ANY venue_admin — a strict tightening, but its admin arm still let
-- an operator of venue A mint a signed URL for a member of an UNRELATED club B.
--
-- This migration venue-SCOPES the admin arm: an operator may read an ID document
-- only if they hold an active, non-revoked `venue_admins` grant over a venue that
-- is linked (`club_venues`) to the exact club the document was submitted to. The
-- object name IS `member_id_documents.storage_path`, so the check is per-document:
--   object -> member_id_documents.club_id -> club_venues.venue_id -> venue_admins(auth.uid)
-- This mirrors how get_my_world() resolves an operator's clubs (venue_admins ∘
-- club_venues) — club_venues is the single canonical club↔venue link, so an
-- operator can read exactly the docs of clubs they actually administer.
--
-- WHY SQL, not a service-role minter: the storage object name already carries the
-- storage_path, so the club can be resolved inside the existing SECDEF helper —
-- no new deploy surface, no service-role secret, and (critically) it works with
-- the CURRENTLY-DEPLOYED apps/venue bundle's client-side createSignedUrl, which a
-- drop-to-owner-only policy would have broken until a manual venue redeploy. A
-- server-side minter (owner-only policy + gated endpoint) remains a valid FUTURE
-- defense-in-depth hardening and is filed as a follow-up in GO_LIVE_ISSUES.md.
--
-- Only the helper body changes; the storage.objects SELECT policy (mig 572) already
-- delegates to _can_read_member_id_object(name) and is untouched.
--
-- LIVE-DATA SAFETY: 34/34 live docs belong to a club with a club_venues link and
-- ≥1 reachable active admin, so NO legitimate operator read regresses; only the
-- illegitimate cross-venue read is removed.
-- Go-live-check (player + guardian onboarding), 2026-07-13.

CREATE OR REPLACE FUNCTION public._can_read_member_id_object(p_object_name text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    -- (a) OWNER — the object lives under the caller's own member_profile-id prefix.
    -- Covers an adult's own doc AND a guardian's upload of a child's doc, because
    -- uploadMemberIdDoc() stores every object under the UPLOADER's own profile-id
    -- prefix (see the INSERT/DELETE policies in migs 294/431).
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.auth_user_id = auth.uid()
        AND starts_with(p_object_name, mp.id::text || '/')
    )
    OR
    -- (b) VENUE-SCOPED ADMIN — the caller holds an active, non-revoked venue_admin
    -- grant over a venue linked (club_venues) to the club this document was
    -- submitted to. Per-document scope: it resolves the club from the exact object.
    EXISTS (
      SELECT 1
      FROM public.member_id_documents d
      JOIN public.club_venues cv ON cv.club_id = d.club_id
      JOIN public.venue_admins va ON va.venue_id = cv.venue_id
      WHERE d.storage_path = p_object_name
        AND va.user_id = auth.uid()
        AND va.status = 'active'
        AND va.revoked_at IS NULL
    );
$function$;

REVOKE ALL   ON FUNCTION public._can_read_member_id_object(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._can_read_member_id_object(text) TO authenticated;
