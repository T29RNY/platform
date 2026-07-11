-- 551: read/unread state on the coach + adult-member announcement feeds (D7).
--
-- Only the GUARDIAN feed had per-notice read state (mig 434). The coach (TeamManagerComms,
-- SessionsScreen) + adult-member feeds read via member_list_club_announcements, which returned
-- only id/title/body/audience/created_at — no read flag, no unread count, no mark-read. The
-- read-state table (club_announcement_reads, mig 434, keyed on member_profile_id) is generic —
-- reuse it for any member. This:
--   • extends member_list_club_announcements → per-notice `read` + top-level `unread_count`
--   • adds member_mark_announcement_read(id) — coach-safe (the guardian mark-read's visibility
--     gate omits club_team_managers, so it can't be reused for a coach)
--   • adds member_mark_all_announcements_read(club_id) — "mark all" over the visible set
-- Every gate uses the SAME club|cohort|team(player OR manager) visibility as the reader.
--
-- Consumers (Hard Rule #14): apps/inorout TeamManagerComms.jsx + SessionsScreen.jsx (coach/member feeds).

CREATE OR REPLACE FUNCTION public.member_list_club_announcements(p_club_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_rows       jsonb;
  v_unread     int;
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

  WITH vis AS (
    SELECT a.id, a.title, a.body, a.audience, a.created_at,
           (rd.announcement_id IS NOT NULL) AS read
    FROM public.club_announcements a
    LEFT JOIN public.club_announcement_reads rd
      ON rd.announcement_id = a.id AND rd.member_profile_id = v_profile_id
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
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'body', body, 'audience', audience, 'created_at', created_at, 'read', read
         ) ORDER BY created_at DESC), '[]'::jsonb),
         COUNT(*) FILTER (WHERE NOT read)::int
    INTO v_rows, v_unread
  FROM vis;

  RETURN jsonb_build_object('ok', true, 'announcements', v_rows, 'unread_count', COALESCE(v_unread, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.member_list_club_announcements(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_list_club_announcements(text) TO authenticated;

-- ── member marks ONE announcement read (coach-safe visibility gate) ──
CREATE OR REPLACE FUNCTION public.member_mark_announcement_read(p_announcement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_ann     record;
  v_ok      boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001'; END IF;

  SELECT id, club_id, audience, cohort_id, team_id, status INTO v_ann
    FROM public.club_announcements WHERE id = p_announcement_id;
  IF v_ann.id IS NULL OR v_ann.status <> 'sent' THEN RAISE EXCEPTION 'announcement_not_found' USING ERRCODE = 'P0001'; END IF;

  v_ok := (v_ann.audience = 'club' AND (
             EXISTS (SELECT 1 FROM public.venue_memberships WHERE member_profile_id = v_profile AND club_id = v_ann.club_id AND status NOT IN ('cancelled'))
             OR EXISTS (SELECT 1 FROM public.club_team_managers ctm JOIN public.club_teams ct ON ct.id = ctm.team_id
                        WHERE ctm.member_profile_id = v_profile AND ctm.is_active = true AND ct.club_id = v_ann.club_id)))
        OR (v_ann.audience = 'cohort' AND EXISTS (
             SELECT 1 FROM public.venue_memberships vm WHERE vm.member_profile_id = v_profile AND vm.club_id = v_ann.club_id
               AND vm.cohort_id = v_ann.cohort_id AND vm.status NOT IN ('cancelled')))
        OR (v_ann.audience = 'team' AND (
             EXISTS (SELECT 1 FROM public.club_team_members ctm WHERE ctm.member_profile_id = v_profile AND ctm.team_id = v_ann.team_id AND ctm.is_active = true)
             OR EXISTS (SELECT 1 FROM public.club_team_managers ctm2 WHERE ctm2.member_profile_id = v_profile AND ctm2.team_id = v_ann.team_id AND ctm2.is_active = true)));
  IF NOT v_ok THEN RAISE EXCEPTION 'not_visible' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.club_announcement_reads (announcement_id, member_profile_id)
  VALUES (p_announcement_id, v_profile) ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_ann.club_id, v_uid, 'player', 'announcement_marked_read', 'club_announcement', p_announcement_id::text,
          jsonb_build_object('member_profile_id', v_profile));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.member_mark_announcement_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_mark_announcement_read(uuid) TO authenticated;

-- ── member marks ALL visible announcements read (mirror the guardian "mark all") ──
CREATE OR REPLACE FUNCTION public.member_mark_all_announcements_read(p_club_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_n       int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001'; END IF;

  WITH visible AS (
    SELECT a.id FROM public.club_announcements a
    WHERE a.club_id = p_club_id AND a.status = 'sent'
      AND (
        a.audience = 'club'
        OR (a.audience = 'cohort' AND EXISTS (
          SELECT 1 FROM public.venue_memberships vm WHERE vm.member_profile_id = v_profile AND vm.club_id = p_club_id
            AND vm.cohort_id = a.cohort_id AND vm.status NOT IN ('cancelled')))
        OR (a.audience = 'team' AND (
          EXISTS (SELECT 1 FROM public.club_team_members ctm WHERE ctm.member_profile_id = v_profile AND ctm.team_id = a.team_id AND ctm.is_active = true)
          OR EXISTS (SELECT 1 FROM public.club_team_managers ctm2 WHERE ctm2.member_profile_id = v_profile AND ctm2.team_id = a.team_id AND ctm2.is_active = true)))
      )
  ), ins AS (
    INSERT INTO public.club_announcement_reads (announcement_id, member_profile_id)
    SELECT id, v_profile FROM visible ON CONFLICT DO NOTHING RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN jsonb_build_object('ok', true, 'marked', COALESCE(v_n, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.member_mark_all_announcements_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_mark_all_announcements_read(text) TO authenticated;
