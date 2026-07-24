-- 619_club_media_policies_secdef_helper_down.sql
-- Restore the mig-444 inline-subquery policies and drop the helper.
-- (Reverts to the broken-but-original state; the 403 bug returns.)

DROP POLICY IF EXISTS "club_media_insert" ON storage.objects;
CREATE POLICY "club_media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'club-media'
    AND EXISTS (
      SELECT 1
      FROM public.club_team_managers ctm
      JOIN public.club_teams      ct ON ct.id = ctm.team_id
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
      WHERE mp.auth_user_id = auth.uid()
        AND ctm.is_active = true
        AND ct.club_id = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "club_media_update" ON storage.objects;
CREATE POLICY "club_media_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'club-media'
    AND EXISTS (
      SELECT 1
      FROM public.club_team_managers ctm
      JOIN public.club_teams      ct ON ct.id = ctm.team_id
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
      WHERE mp.auth_user_id = auth.uid()
        AND ctm.is_active = true
        AND ct.club_id = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'club-media'
    AND EXISTS (
      SELECT 1
      FROM public.club_team_managers ctm
      JOIN public.club_teams      ct ON ct.id = ctm.team_id
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
      WHERE mp.auth_user_id = auth.uid()
        AND ctm.is_active = true
        AND ct.club_id = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "club_media_delete" ON storage.objects;
CREATE POLICY "club_media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'club-media'
    AND EXISTS (
      SELECT 1
      FROM public.club_team_managers ctm
      JOIN public.club_teams      ct ON ct.id = ctm.team_id
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
      WHERE mp.auth_user_id = auth.uid()
        AND ctm.is_active = true
        AND ct.club_id = (storage.foldername(name))[1]
    )
  );

DROP FUNCTION IF EXISTS public._user_can_manage_club_media(text);
