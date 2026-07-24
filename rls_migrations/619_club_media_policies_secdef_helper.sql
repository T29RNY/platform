-- 619_club_media_policies_secdef_helper.sql
--
-- FIX: club-media image upload/update/delete 403'd for EVERY user.
--
-- The three `club-media` storage RLS policies (mig 444) evaluate an EXISTS
-- subquery over public.member_profiles / club_team_managers / club_teams AS THE
-- `authenticated` caller. But those tables carry NO SELECT grant to `authenticated`
-- (platform posture: base tables are RLS-on with access only via SECURITY DEFINER
-- RPCs). So the policy predicate raised "permission denied for table
-- member_profiles" and Postgres treated the row as failing the check — every club
-- crest / hero / sponsor upload, update and delete returned 403 for all users.
--
-- Move the membership check into a SECURITY DEFINER helper. The helper reads the
-- base tables with definer rights (owner), while auth.uid() still resolves to the
-- REAL caller (it reads the request JWT `sub`, which is request-scoped and
-- unaffected by the definer role switch — the same pattern resolve_admin_caller and
-- the other _* helpers already rely on). The three policies then call the helper.
-- The authorization predicate is byte-identical to mig 444 — no scope change, only
-- the execution context that lets the base-table reads succeed.

CREATE OR REPLACE FUNCTION public._user_can_manage_club_media(p_object_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.club_team_managers ctm
    JOIN public.club_teams      ct ON ct.id = ctm.team_id
    JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
    WHERE mp.auth_user_id = auth.uid()
      AND ctm.is_active = true
      AND ct.club_id = (storage.foldername(p_object_name))[1]
  );
$$;

REVOKE ALL     ON FUNCTION public._user_can_manage_club_media(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._user_can_manage_club_media(text) TO authenticated;

-- Rewrite the three policies to call the helper (predicate byte-identical to mig 444).
DROP POLICY IF EXISTS "club_media_insert" ON storage.objects;
CREATE POLICY "club_media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'club-media'
    AND public._user_can_manage_club_media(name)
  );

DROP POLICY IF EXISTS "club_media_update" ON storage.objects;
CREATE POLICY "club_media_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'club-media'
    AND public._user_can_manage_club_media(name)
  )
  WITH CHECK (
    bucket_id = 'club-media'
    AND public._user_can_manage_club_media(name)
  );

DROP POLICY IF EXISTS "club_media_delete" ON storage.objects;
CREATE POLICY "club_media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'club-media'
    AND public._user_can_manage_club_media(name)
  );
