-- 529: Club-announcement history visible to coach-managers + club-admins.
--
-- Two read-only changes so the "who's sent what" history is visible to the roles that need
-- it (operator follow-ups to the /hub Comms screens):
--
-- 1. member_list_club_announcements — ALSO authorise a non-member COACH. Today it requires an
--    active venue_membership, so a volunteer coach who manages via club_team_managers but
--    isn't a paying member gets 'not_a_member' and sees no history. Add: pass if the caller is
--    an active club_team_managers on any team in the club; and let the team-audience branch
--    include teams they MANAGE (not just teams they're a rostered player of). Additive to auth
--    (more callers pass) + visibility — no existing caller loses access.
--
-- 2. venue_list_club_announcements — NEW venue-token reader for the club-admin (a venue_admin
--    is not a club member, so member_list_* rejects them). Authorises EXACTLY like
--    venue_list_club_committee (mig 521): resolve_venue_caller -> club linked to the caller's
--    venue via club_venues -> return the club's sent announcements (ALL audiences — the admin
--    sees everything). Read-only.
--
-- Both STABLE / SECURITY DEFINER / search_path pinned. Only 'sent' rows (queued flips to sent
-- via the delivery cron). No writes -> no EV.
-- Consumers (Hard Rule #14): apps/inorout TeamManagerComms.jsx (coach) + ClubAdminComms.jsx (admin).

-- ── 1. member_list_club_announcements — + coach-manager auth & team visibility ──────────────
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

  -- Authorised as EITHER an active club member OR an active coach/manager of a team in the club.
  IF NOT EXISTS (
        SELECT 1 FROM public.venue_memberships
        WHERE member_profile_id = v_profile_id
          AND club_id = p_club_id
          AND status NOT IN ('cancelled')
      )
     AND NOT EXISTS (
        SELECT 1 FROM public.club_team_managers ctm
        JOIN public.club_teams ct ON ct.id = ctm.team_id
        WHERE ctm.member_profile_id = v_profile_id
          AND ctm.is_active = true
          AND ct.club_id = p_club_id
      )
  THEN
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
            OR (a.audience = 'team' AND (
              EXISTS (
                SELECT 1 FROM public.club_team_members ctm
                WHERE ctm.member_profile_id = v_profile_id
                  AND ctm.team_id = a.team_id
                  AND ctm.is_active = true
              )
              OR EXISTS (
                SELECT 1 FROM public.club_team_managers ctm2
                WHERE ctm2.member_profile_id = v_profile_id
                  AND ctm2.team_id = a.team_id
                  AND ctm2.is_active = true
              )
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

-- ── 2. venue_list_club_announcements — venue-token reader for the club-admin ─────────────────
CREATE OR REPLACE FUNCTION public.venue_list_club_announcements(
  p_venue_token text,
  p_club_id     text
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_caller record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = p_club_id AND cv.venue_id = v_caller.venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
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
        ORDER BY a.created_at DESC
        LIMIT 20
      ) a
    ), '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL    ON FUNCTION public.venue_list_club_announcements(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_list_club_announcements(text, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
