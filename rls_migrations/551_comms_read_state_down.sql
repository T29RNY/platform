-- 551 DOWN: drop the two mark-read RPCs + restore member_list_club_announcements to its pre-551
-- body (no `read` flag, no `unread_count`).

DROP FUNCTION IF EXISTS public.member_mark_announcement_read(uuid);
DROP FUNCTION IF EXISTS public.member_mark_all_announcements_read(text);

CREATE OR REPLACE FUNCTION public.member_list_club_announcements(p_club_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
        SELECT 1 FROM public.venue_memberships
        WHERE member_profile_id = v_profile_id AND club_id = p_club_id AND status NOT IN ('cancelled')
      )
     AND NOT EXISTS (
        SELECT 1 FROM public.club_team_managers ctm JOIN public.club_teams ct ON ct.id = ctm.team_id
        WHERE ctm.member_profile_id = v_profile_id AND ctm.is_active = true AND ct.club_id = p_club_id
      )
  THEN RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'P0001'; END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'announcements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'body', a.body, 'audience', a.audience, 'created_at', a.created_at
      ) ORDER BY a.created_at DESC)
      FROM (
        SELECT a.id, a.title, a.body, a.audience, a.created_at
        FROM public.club_announcements a
        WHERE a.club_id = p_club_id AND a.status = 'sent'
          AND (
            a.audience = 'club'
            OR (a.audience = 'cohort' AND EXISTS (
              SELECT 1 FROM public.venue_memberships vm
              WHERE vm.member_profile_id = v_profile_id AND vm.club_id = p_club_id
                AND vm.cohort_id = a.cohort_id AND vm.status NOT IN ('cancelled')))
            OR (a.audience = 'team' AND (
              EXISTS (SELECT 1 FROM public.club_team_members ctm
                      WHERE ctm.member_profile_id = v_profile_id AND ctm.team_id = a.team_id AND ctm.is_active = true)
              OR EXISTS (SELECT 1 FROM public.club_team_managers ctm2
                         WHERE ctm2.member_profile_id = v_profile_id AND ctm2.team_id = a.team_id AND ctm2.is_active = true)))
          )
        ORDER BY a.created_at DESC
        LIMIT 20
      ) a
    ), '[]'::jsonb)
  );
END;
$function$;
