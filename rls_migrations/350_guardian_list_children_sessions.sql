-- Migration 350 — Multi-context nav (Phase 1): guardian children-sessions feed.
--
-- WHY: the guardian Home must show, per child, ALL upcoming training + matches
-- across ALL the child's clubs/cohorts/teams — even clubs the guardian is NOT a
-- member of. Today no RPC returns this: get_guardian_home_feed (mig 314) returns
-- only the single NEXT session per child, and member_list_upcoming_sessions
-- (mig 299) is single-club and requires the CALLER'S own membership. That's the
-- discovery gap a child in a club the parent isn't in is invisible.
--
-- WHAT: new SECURITY DEFINER read RPC. For every ACCEPTED child of the caller
-- (member_guardians), every scheduled future session the child is eligible for,
-- with the child's current RSVP status. A "match" is just a club_sessions row
-- with session_type/opponent/meet_time (mig 300) so it's covered automatically.
--
-- GATING: guardian->child via member_guardians (invite_state='accepted'); then
-- child->session eligibility mirrors member_list_upcoming_sessions (mig 299):
--   (a) whole-cohort session + child has active membership matching the cohort
--   (b) team-specific session + child is an active club_team_member
--   (c) child is a named session guest
-- NO guardian-own-membership requirement (the whole point). The write side is
-- already guardian-aware: member_rsvp_session(forProfileId=child) (mig 299).
--
-- Consumers (Hard Rule #14): apps/inorout guardian Home (ParentHomeScreen).
-- GRANT anon + authenticated per the parity-sweep grant discipline; the body
-- requires auth.uid() so anon callers get not_authenticated.

CREATE OR REPLACE FUNCTION public.guardian_list_children_sessions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_guardian uuid;
  v_children jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_guardian
  FROM member_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF v_guardian IS NULL THEN
    RETURN jsonb_build_object('children', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(child_obj ORDER BY fname, lname), '[]'::jsonb)
  INTO v_children
  FROM (
    SELECT
      child.first_name AS fname,
      child.last_name  AS lname,
      jsonb_build_object(
        'profile_id', child.id,
        'first_name', child.first_name,
        'last_name',  child.last_name,
        'sessions', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'session_id',          cs.id,
              'club_id',             cs.club_id,
              'club_name',           cl.name,
              'cohort_id',           cs.cohort_id,
              'cohort_name',         cc.name,
              'team_id',             cs.team_id,
              'title',               cs.title,
              'session_type',        cs.session_type,
              'scheduled_at',        cs.scheduled_at,
              'meet_time',           cs.meet_time,
              'location',            cs.location,
              'opponent_name',       cs.opponent_name,
              'home_away',           cs.home_away,
              'opponent_venue_name', cs.opponent_venue_name,
              'opponent_address',    cs.opponent_address,
              'notes',               cs.notes,
              'capacity',            cs.capacity,
              'own_rsvp_status',     r.status
            ) ORDER BY cs.scheduled_at
          )
          FROM club_sessions cs
          JOIN clubs cl ON cl.id = cs.club_id
          LEFT JOIN club_cohorts cc ON cc.id = cs.cohort_id
          LEFT JOIN club_session_rsvps r
                 ON r.session_id = cs.id AND r.member_profile_id = child.id
          WHERE cs.status = 'scheduled'
            AND cs.scheduled_at > now()
            AND EXISTS (
              SELECT 1 FROM venue_memberships vm
              WHERE vm.club_id = cs.club_id
                AND vm.member_profile_id = child.id
                AND vm.status IN ('active', 'ending')
            )
            AND (
              -- (a) whole-cohort session: child has active membership for this cohort
              (cs.team_id IS NULL AND EXISTS (
                SELECT 1 FROM venue_memberships vm
                WHERE vm.club_id = cs.club_id
                  AND vm.member_profile_id = child.id
                  AND vm.status IN ('active', 'ending')
                  AND (cs.cohort_id IS NULL OR vm.cohort_id = cs.cohort_id)
              ))
              OR
              -- (b) team-specific session: child is an active player on that team
              (cs.team_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM club_team_members ctm
                WHERE ctm.team_id = cs.team_id
                  AND ctm.member_profile_id = child.id
                  AND ctm.is_active = true
              ))
              OR
              -- (c) child is a named session guest
              EXISTS (
                SELECT 1 FROM club_session_guests csg
                WHERE csg.session_id = cs.id
                  AND csg.member_profile_id = child.id
              )
            )
        ), '[]'::jsonb)
      ) AS child_obj
    FROM member_guardians mg
    JOIN member_profiles child ON child.id = mg.child_profile_id
    WHERE mg.guardian_profile_id = v_guardian
      AND mg.invite_state = 'accepted'
  ) children_q;

  RETURN jsonb_build_object('children', v_children);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_list_children_sessions() FROM public;
GRANT EXECUTE ON FUNCTION public.guardian_list_children_sessions() TO anon, authenticated;
