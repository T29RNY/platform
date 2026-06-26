-- Migration 434 — Guardian "Club notices" inbox: per-child read model + mark-as-read.
--
-- Read-only consumption of existing club_announcements (the operator Broadcast composer is
-- unbuilt). The existing member_list_club_announcements gates on the CALLER's own membership
-- and carries no sender/read state; a guardian is not a club member (the child is), so this
-- adds a guardian-gated, child-scoped reader + a small read-state table to drive the badge.
--
-- Consumers: apps/inorout mobile GuardianNotices.jsx (More hub → Club notices).

-- ── read-state table (RPC-only; RLS on, no policies → all client roles blocked) ──────────
CREATE TABLE IF NOT EXISTS public.club_announcement_reads (
  announcement_id   uuid NOT NULL REFERENCES public.club_announcements(id) ON DELETE CASCADE,
  member_profile_id uuid NOT NULL REFERENCES public.member_profiles(id)   ON DELETE CASCADE,
  read_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, member_profile_id)
);
ALTER TABLE public.club_announcement_reads ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.club_announcement_reads IS
  'Per-reader seen state for club_announcements. member_profile_id = the person who read (e.g. the guardian). RPC-only via SECURITY DEFINER; no RLS policies.';

-- ── reader: the child's visible notices + this caller's read flag ────────────────────────
-- Audience visibility mirrors member_list_club_announcements but resolves the CHILD's
-- memberships/teams (not the caller's). Sender resolves: composer person → team coach
-- (team audience) → club name.
CREATE OR REPLACE FUNCTION public.guardian_list_child_notices(p_child_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_caller  uuid;
  v_child   uuid := NULLIF(p_child_profile_id, '')::uuid;
  v_notices jsonb;
  v_unread  int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF v_child IS NULL THEN RAISE EXCEPTION 'child_required' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_caller FROM member_profiles WHERE auth_user_id = v_uid;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  IF v_child <> v_caller AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller AND child_profile_id = v_child AND invite_state = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
  END IF;

  WITH vis AS (
    SELECT a.id, a.title, a.body, a.audience, a.created_at, a.created_by, a.club_id, a.team_id
    FROM public.club_announcements a
    WHERE a.status = 'sent'
      AND (
        (a.audience = 'club' AND EXISTS (
          SELECT 1 FROM public.venue_memberships vm
          WHERE vm.member_profile_id = v_child AND vm.club_id = a.club_id
            AND vm.status NOT IN ('cancelled')
        ))
        OR (a.audience = 'cohort' AND EXISTS (
          SELECT 1 FROM public.venue_memberships vm
          WHERE vm.member_profile_id = v_child AND vm.club_id = a.club_id
            AND vm.cohort_id = a.cohort_id AND vm.status NOT IN ('cancelled')
        ))
        OR (a.audience = 'team' AND EXISTS (
          SELECT 1 FROM public.club_team_members ctm
          WHERE ctm.member_profile_id = v_child AND ctm.team_id = a.team_id AND ctm.is_active = true
        ))
      )
    ORDER BY a.created_at DESC
    LIMIT 30
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',           v.id,
      'title',        v.title,
      'body',         v.body,
      'audience',     v.audience,
      'created_at',   v.created_at,
      'sender_label', COALESCE(
                        NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), ''),
                        coach.coach_name,
                        c.name
                      ),
      'sender_kind',  CASE
                        WHEN COALESCE(NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), ''),
                                      coach.coach_name) IS NOT NULL THEN 'person'
                        ELSE 'club'
                      END,
      'read',         (rd.announcement_id IS NOT NULL)
    ) ORDER BY v.created_at DESC), '[]'::jsonb),
    COUNT(*) FILTER (WHERE rd.announcement_id IS NULL)
  INTO v_notices, v_unread
  FROM vis v
  LEFT JOIN public.clubs c ON c.id = v.club_id
  LEFT JOIN public.member_profiles mp ON mp.auth_user_id = v.created_by
  LEFT JOIN LATERAL (
    SELECT NULLIF(btrim(COALESCE(tmp.first_name,'') || ' ' || COALESCE(tmp.last_name,'')), '') AS coach_name
    FROM public.club_team_managers tm
    JOIN public.member_profiles tmp ON tmp.id = tm.member_profile_id
    WHERE v.audience = 'team' AND tm.team_id = v.team_id AND tm.is_active = true
    ORDER BY tmp.first_name
    LIMIT 1
  ) coach ON true
  LEFT JOIN public.club_announcement_reads rd
    ON rd.announcement_id = v.id AND rd.member_profile_id = v_caller;

  RETURN jsonb_build_object(
    'ok', true,
    'child_profile_id', v_child,
    'caller_profile_id', v_caller,
    'notices', COALESCE(v_notices, '[]'::jsonb),
    'unread_count', COALESCE(v_unread, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_list_child_notices(text) FROM public;
GRANT EXECUTE ON FUNCTION public.guardian_list_child_notices(text) TO anon, authenticated;

-- ── write: mark one notice read (keyed on the guardian/caller) ───────────────────────────
-- Authenticated-only. Verifies the caller is an accepted guardian of the child (or self) AND
-- that the notice is actually visible to that child before recording the read. Audit per HR#9.
CREATE OR REPLACE FUNCTION public.guardian_mark_notice_read(p_announcement_id uuid, p_for_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_prof    record;
  v_caller  uuid;
  v_child   uuid := NULLIF(p_for_profile_id, '')::uuid;
  v_ann     record;
  v_visible boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF p_announcement_id IS NULL THEN RAISE EXCEPTION 'announcement_required' USING ERRCODE='P0001'; END IF;
  IF v_child IS NULL THEN RAISE EXCEPTION 'child_required' USING ERRCODE='P0001'; END IF;
  SELECT id, first_name, last_name INTO v_prof FROM member_profiles WHERE auth_user_id = v_uid;
  IF v_prof.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  v_caller := v_prof.id;
  IF v_child <> v_caller AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller AND child_profile_id = v_child AND invite_state = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_ann FROM public.club_announcements WHERE id = p_announcement_id AND status = 'sent';
  IF NOT FOUND THEN RAISE EXCEPTION 'notice_not_found' USING ERRCODE='P0001'; END IF;

  v_visible := (
    (v_ann.audience = 'club' AND EXISTS (
      SELECT 1 FROM public.venue_memberships vm
      WHERE vm.member_profile_id = v_child AND vm.club_id = v_ann.club_id AND vm.status NOT IN ('cancelled')))
    OR (v_ann.audience = 'cohort' AND EXISTS (
      SELECT 1 FROM public.venue_memberships vm
      WHERE vm.member_profile_id = v_child AND vm.club_id = v_ann.club_id
        AND vm.cohort_id = v_ann.cohort_id AND vm.status NOT IN ('cancelled')))
    OR (v_ann.audience = 'team' AND EXISTS (
      SELECT 1 FROM public.club_team_members ctm
      WHERE ctm.member_profile_id = v_child AND ctm.team_id = v_ann.team_id AND ctm.is_active = true))
  );
  IF NOT v_visible THEN RAISE EXCEPTION 'not_visible' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.club_announcement_reads (announcement_id, member_profile_id)
  VALUES (p_announcement_id, v_caller)
  ON CONFLICT (announcement_id, member_profile_id) DO NOTHING;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', v_uid, 'player',
    COALESCE(NULLIF(btrim(COALESCE(v_prof.first_name,'') || ' ' || COALESCE(v_prof.last_name,'')), ''), 'guardian'),
    'guardian_notice_read', 'club_announcement', p_announcement_id::text,
    jsonb_build_object('child_profile_id', v_child, 'club_id', v_ann.club_id, 'audience', v_ann.audience)
  );

  RETURN jsonb_build_object('ok', true, 'read', true, 'announcement_id', p_announcement_id);
END;
$function$;

-- REVOKE FROM public does not strip the implicit anon grant from Supabase default privileges.
REVOKE ALL ON FUNCTION public.guardian_mark_notice_read(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.guardian_mark_notice_read(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.guardian_mark_notice_read(uuid, text) TO authenticated;
