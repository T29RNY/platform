-- 572_member_id_docs_select_scope.sql
-- Close the over-broad read on members'/children's ID documents (passports,
-- birth certificates, proof of age) surfaced by the onboarding go-live check.
--
-- BEFORE: storage.objects policy member_id_docs_select =
--           USING (bucket_id = 'member-id-docs')
--         i.e. ANY authenticated user (any player, any guardian, any gym
--         member) could mint a signed URL for ANY object in the private bucket,
--         relying only on UUID-opaque paths (security-by-obscurity over
--         special-category documents).
--
-- AFTER: readable only by
--   (a) the OWNER — the object lives under the caller's own member_profile-id
--       prefix. This covers an adult's own doc AND a guardian's upload of a
--       child's doc, because uploadMemberIdDoc() stores every object under the
--       UPLOADER's own profile-id prefix (see the matching INSERT/DELETE
--       policies in 294/431); and
--   (b) any VENUE ADMIN — operators verify member/child ID documents via a
--       signed URL and sign in with auth.uid(). Keeping every venue admin able
--       to read preserves the verification path (a naive owner-only scope would
--       lock operators out).
--
-- The check MUST run in a SECURITY DEFINER helper: member_profiles and
-- venue_admins are both RLS-deny-all (no policies), so a bare subquery inside an
-- `authenticated` policy would see zero rows and block everyone. The definer
-- helper reads those tables as its owner while auth.uid() still resolves to the
-- calling user.
--
-- Residual (tracked follow-up): the admin arm is not yet venue-scoped — a venue
-- admin of venue A can still read venue B's documents. The full fix is a
-- server-side, venue-scoped signed-URL minter (service-role), filed separately.
-- This migration is a strict tightening: it only REMOVES the "any authenticated
-- user" reader; every legitimate reader today is retained.
-- Go-live-check (player + guardian onboarding), 2026-07-13.

CREATE OR REPLACE FUNCTION public._can_read_member_id_object(p_object_name text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.auth_user_id = auth.uid()
        AND starts_with(p_object_name, mp.id::text || '/')
    )
    OR
    EXISTS (
      SELECT 1 FROM public.venue_admins va
      WHERE va.user_id = auth.uid()
    );
$function$;

REVOKE ALL   ON FUNCTION public._can_read_member_id_object(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._can_read_member_id_object(text) TO authenticated;

DROP POLICY IF EXISTS member_id_docs_select ON storage.objects;
CREATE POLICY member_id_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'member-id-docs'
    AND public._can_read_member_id_object(name)
  );
