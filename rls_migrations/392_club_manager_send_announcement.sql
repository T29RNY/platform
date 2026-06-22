-- Migration 392 — Club Structure Phase 4: Team-manager comms
-- New RPC: club_manager_send_announcement  (authenticated manager-of-team)
--   Mirrors the club_manager_* auth pattern (mig 304): auth.uid() → member_profiles
--   → club_team_managers (is_active, team_id). Inserts a queued club_announcements
--   row (audience='team') so the EXISTING cron delivery (apps/inorout/api/cron.js:791
--   → get_pending_club_broadcasts) and the existing member-side feed
--   (member_list_club_announcements) carry it — no parallel system.
--   The club-WIDE broadcast stays the venue-admin club_send_announcement (mig 307);
--   this is the team-manager-scoped complement.
-- Modified RPC: get_pending_club_broadcasts — the audience='team' recipient set now
--   ALSO includes accepted guardians (member_guardians.invite_state='accepted') of the
--   team's members, so team messages reach players AND their guardians. Additive to the
--   recipients[] array; the only consumer is cron.js iterating recipients[].email.

-- ─── 1. club_manager_send_announcement ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_manager_send_announcement(
  p_team_id uuid,
  p_title   text,
  p_body    text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid             uuid := auth.uid();
  v_profile         record;
  v_team            record;
  v_venue_id        text;
  v_announcement_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, club_id, name INTO v_team
    FROM public.club_teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_manager' USING ERRCODE = 'P0001';
  END IF;

  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_body IS NULL OR trim(p_body) = '' THEN
    RAISE EXCEPTION 'body_required' USING ERRCODE = 'P0001';
  END IF;

  -- venue_id is required on club_announcements (used only for the broadcast's
  -- club/venue display name). Derive from the team's club.
  SELECT venue_id INTO v_venue_id
    FROM public.club_venues WHERE club_id = v_team.club_id
    ORDER BY created_at LIMIT 1;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_announcements (
    club_id, venue_id, created_by, title, body, audience, cohort_id, team_id
  ) VALUES (
    v_team.club_id, v_venue_id, v_uid, trim(p_title), trim(p_body),
    'team', NULL, p_team_id
  )
  RETURNING id INTO v_announcement_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    '_system',
    v_uid,
    'player',
    v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
    'club_manager_announcement_queued',
    'club_announcement',
    v_announcement_id::text,
    jsonb_build_object('team_id', p_team_id, 'club_id', v_team.club_id, 'title', p_title)
  );

  RETURN jsonb_build_object('ok', true, 'announcement_id', v_announcement_id);
END;
$fn$;

REVOKE ALL    ON FUNCTION public.club_manager_send_announcement(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_send_announcement(uuid, text, text) TO authenticated;

-- ─── 2. get_pending_club_broadcasts — add guardian recipients to team audience ──

CREATE OR REPLACE FUNCTION public.get_pending_club_broadcasts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'ok', true,
    'broadcasts', COALESCE(jsonb_agg(b ORDER BY (b->>'created_at')), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'announcement_id', a.id,
      'club_id',         a.club_id,
      'title',           a.title,
      'body',            a.body,
      'audience',        a.audience,
      'club_name',       cl.name,
      'venue_name',      v.name,
      'created_at',      a.created_at,
      'recipients', COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object(
          'member_profile_id', mp2.id,
          'first_name',        mp2.first_name,
          'email',             mp2.email
        ))
        FROM (
          SELECT mp2.id, mp2.first_name, mp2.email
          FROM public.venue_memberships vm
          JOIN public.member_profiles mp2 ON mp2.id = vm.member_profile_id
          WHERE a.audience = 'club'
            AND vm.club_id = a.club_id
            AND vm.status NOT IN ('cancelled')
            AND vm.member_profile_id IS NOT NULL
            AND mp2.email IS NOT NULL
          UNION
          SELECT mp2.id, mp2.first_name, mp2.email
          FROM public.venue_memberships vm
          JOIN public.member_profiles mp2 ON mp2.id = vm.member_profile_id
          WHERE a.audience = 'cohort'
            AND vm.club_id = a.club_id
            AND vm.cohort_id = a.cohort_id
            AND vm.status NOT IN ('cancelled')
            AND vm.member_profile_id IS NOT NULL
            AND mp2.email IS NOT NULL
          UNION
          SELECT mp2.id, mp2.first_name, mp2.email
          FROM public.club_team_members ctm
          JOIN public.member_profiles mp2 ON mp2.id = ctm.member_profile_id
          WHERE a.audience = 'team'
            AND ctm.team_id = a.team_id
            AND ctm.is_active = true
            AND mp2.email IS NOT NULL
          UNION
          -- accepted guardians of the team's members (Phase 4)
          SELECT g_mp.id, g_mp.first_name, g_mp.email
          FROM public.club_team_members ctm
          JOIN public.member_guardians mg
            ON mg.child_profile_id = ctm.member_profile_id
           AND mg.invite_state = 'accepted'
          JOIN public.member_profiles g_mp ON g_mp.id = mg.guardian_profile_id
          WHERE a.audience = 'team'
            AND ctm.team_id = a.team_id
            AND ctm.is_active = true
            AND g_mp.email IS NOT NULL
        ) mp2
      ), '[]'::jsonb)
    ) AS b
    FROM public.club_announcements a
    JOIN public.clubs cl  ON cl.id = a.club_id
    JOIN public.venues v  ON v.id  = a.venue_id
    WHERE a.status = 'queued'
  ) sub;

  RETURN COALESCE(v_result, jsonb_build_object('ok', true, 'broadcasts', '[]'::jsonb));
END;
$fn$;

REVOKE ALL     ON FUNCTION public.get_pending_club_broadcasts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_club_broadcasts() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_pending_club_broadcasts() TO service_role;
