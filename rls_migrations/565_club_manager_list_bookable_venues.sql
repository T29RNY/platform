-- 565_club_manager_list_bookable_venues.sql
-- Coach self-service pitch booking — Cycle 2 (pitch in Training setup): a manager-gated
-- reader for the grounds a Manager can book on.
--
-- WHY: booking a pitch is MANAGER-gated (club_manager_book_pitch → active club_team_manager,
-- mig 560), but the only existing client source for a club's linked venues is
-- member_get_self.active_clubs[].venues — which is MEMBERSHIP-gated (built FROM
-- venue_memberships). On live data 5 of 8 active manager↔club pairs have NO membership,
-- so those Managers can book (auth allows it) yet would see NO grounds to pick from. This
-- reader aligns venue-VISIBILITY with booking-AUTH: same auth chain as
-- club_manager_pitch_availability (mig 558), returning the team's club's club_venues.
--
-- Returns the SAME shape as active_clubs[].venues — { venue_id, venue_name } — so the
-- client is a drop-in reuse of the desktop data contract, just manager-gated. READ-only
-- (no mutation); SECDEF, authenticated-only, anon revoked.
--
-- Reuse, not a parallel system: reuses the club_venues table + the club_manager_pitch_
-- availability auth pattern; it is the missing sibling reader (availability needs a
-- venue_id already chosen; this enumerates which venues to choose from).
--
-- Consumers (Hard Rule #14): apps/inorout mobile TeamManagerTraining (the Manager
-- Add-session pitch picker) + potentially the desktop CoachBookPitchModal.

CREATE OR REPLACE FUNCTION public.club_manager_list_bookable_venues(p_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_club    text;
  v_venues  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;

  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club FROM public.club_teams WHERE id = p_team_id;
  IF v_club IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('venue_id', v.id, 'venue_name', v.name) ORDER BY v.name), '[]'::jsonb)
    INTO v_venues
    FROM public.club_venues cv
    JOIN public.venues v ON v.id = cv.venue_id
    WHERE cv.club_id = v_club;

  RETURN jsonb_build_object('ok', true, 'venues', v_venues);
END;
$fn$;
REVOKE ALL     ON FUNCTION public.club_manager_list_bookable_venues(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_list_bookable_venues(uuid) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
