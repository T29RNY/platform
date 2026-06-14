-- Migration 307 — Phase 11 Club Comms: broadcast announcements
-- New table: club_announcements
-- New RPCs:
--   club_send_announcement         (venue token, manage_memberships cap)
--   get_pending_club_broadcasts    (service_role only — cron pickup)
--   member_list_club_announcements (authenticated — scoped to caller's visibility)

-- ─── 1. club_announcements ───────────────────────────────────────────────────

CREATE TABLE public.club_announcements (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  venue_id         text        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  title            text        NOT NULL,
  body             text        NOT NULL,
  audience         text        NOT NULL CHECK (audience IN ('club', 'cohort', 'team')),
  cohort_id        uuid        REFERENCES public.club_cohorts(id) ON DELETE SET NULL,
  team_id          uuid        REFERENCES public.club_teams(id) ON DELETE SET NULL,
  status           text        NOT NULL DEFAULT 'queued'
                               CHECK (status IN ('queued', 'sent', 'failed')),
  email_sent_count int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

CREATE INDEX club_announcements_club_idx    ON public.club_announcements (club_id);
CREATE INDEX club_announcements_pending_idx ON public.club_announcements (status) WHERE status = 'queued';

ALTER TABLE public.club_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_announcements FROM anon, authenticated;

-- ─── 2. club_send_announcement ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_send_announcement(
  p_token     text,
  p_club_id   text,
  p_title     text,
  p_body      text,
  p_audience  text,
  p_cohort_id uuid DEFAULT NULL,
  p_team_id   uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_caller         record;
  v_venue_id       text;
  v_announcement_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  v_venue_id := v_caller.venue_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE venue_id = v_venue_id AND club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_body IS NULL OR trim(p_body) = '' THEN
    RAISE EXCEPTION 'body_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_audience NOT IN ('club', 'cohort', 'team') THEN
    RAISE EXCEPTION 'invalid_audience' USING ERRCODE = 'P0001';
  END IF;
  IF p_audience = 'cohort' AND p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'cohort_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_audience = 'team' AND p_team_id IS NULL THEN
    RAISE EXCEPTION 'team_id_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_cohorts
    WHERE id = p_cohort_id AND club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_teams
    WHERE id = p_team_id AND club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_announcements (
    club_id, venue_id, created_by, title, body, audience, cohort_id, team_id
  ) VALUES (
    p_club_id, v_venue_id, auth.uid(), trim(p_title), trim(p_body),
    p_audience, p_cohort_id, p_team_id
  )
  RETURNING id INTO v_announcement_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue_id,
    auth.uid(),
    v_caller.actor_type,
    v_caller.actor_ident,
    'club_announcement_queued',
    'club_announcement',
    v_announcement_id::text,
    jsonb_build_object('club_id', p_club_id, 'audience', p_audience, 'title', p_title)
  );

  RETURN jsonb_build_object('ok', true, 'announcement_id', v_announcement_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_send_announcement(text, text, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_send_announcement(text, text, text, text, text, uuid, uuid) TO anon, authenticated;

-- ─── 3. get_pending_club_broadcasts (service_role only — cron) ───────────────

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

REVOKE ALL ON FUNCTION public.get_pending_club_broadcasts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_club_broadcasts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_club_broadcasts() TO service_role;

-- ─── 4. member_list_club_announcements (authenticated — member) ──────────────

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

REVOKE ALL ON FUNCTION public.member_list_club_announcements(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_list_club_announcements(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.member_list_club_announcements(text) TO authenticated;
