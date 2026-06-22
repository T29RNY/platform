-- Down for migration 392 — Club Structure Phase 4: Team-manager comms
-- Drops the new manager RPC and restores get_pending_club_broadcasts to its
-- mig-307 body (team audience = members only, no guardians).

DROP FUNCTION IF EXISTS public.club_manager_send_announcement(uuid, text, text);

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

REVOKE ALL     ON FUNCTION public.get_pending_club_broadcasts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_club_broadcasts() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_pending_club_broadcasts() TO service_role;
