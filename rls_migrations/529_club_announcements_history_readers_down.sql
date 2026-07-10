-- 529 DOWN: revert member_list_club_announcements to the mig-307 body (member-only auth,
-- team-audience keyed on club_team_members only) and drop the new venue-token reader.
-- Removing the coach-manager arm is safe: coach-managers who aren't members simply lose the
-- history again (pre-529 behaviour). The mobile TeamManagerComms/ClubAdminComms soft-hide on
-- error, so no crash — but re-point ClubAdminComms off venue_list_club_announcements first.

CREATE OR REPLACE FUNCTION public.member_list_club_announcements(
  p_club_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  SELECT id INTO v_profile_id
  FROM public.member_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE member_profile_id = v_profile_id
      AND club_id = p_club_id
      AND status NOT IN ('cancelled')
  ) THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'announcements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',         a.id,
        'title',      a.title,
        'body',       a.body,
        'audience',   a.audience,
        'created_at', a.created_at
      ) ORDER BY a.created_at DESC)
      FROM (
        SELECT a.id, a.title, a.body, a.audience, a.created_at
        FROM public.club_announcements a
        WHERE a.club_id = p_club_id
          AND a.status = 'sent'
          AND (
            a.audience = 'club'
            OR (a.audience = 'cohort' AND EXISTS (
              SELECT 1 FROM public.venue_memberships vm
              WHERE vm.member_profile_id = v_profile_id
                AND vm.club_id = p_club_id
                AND vm.cohort_id = a.cohort_id
                AND vm.status NOT IN ('cancelled')
            ))
            OR (a.audience = 'team' AND EXISTS (
              SELECT 1 FROM public.club_team_members ctm
              WHERE ctm.member_profile_id = v_profile_id
                AND ctm.team_id = a.team_id
                AND ctm.is_active = true
            ))
          )
        ORDER BY a.created_at DESC
        LIMIT 20
      ) a
    ), '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL     ON FUNCTION public.member_list_club_announcements(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_list_club_announcements(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.member_list_club_announcements(text) TO authenticated;

DROP FUNCTION IF EXISTS public.venue_list_club_announcements(text, text);

SELECT pg_notify('pgrst', 'reload schema');
