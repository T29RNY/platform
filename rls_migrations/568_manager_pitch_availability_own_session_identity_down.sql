-- 568 DOWN: restore club_manager_pitch_availability to its pre-enrichment busy shape
-- (playing_area_id/start/end only). Additive keys removed; auth/grants unchanged.
CREATE OR REPLACE FUNCTION public.club_manager_pitch_availability(p_team_id uuid, p_venue_id text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_club    text;
  v_range   tstzrange;
  v_pitches jsonb;
  v_busy    jsonb;
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
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = v_club AND venue_id = p_venue_id
  ) THEN
    RAISE EXCEPTION 'venue_not_in_club' USING ERRCODE = 'P0001';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'date_range_required' USING ERRCODE = 'P0001';
  END IF;
  v_range := tstzrange(
    (p_from::timestamp) AT TIME ZONE 'Europe/London',
    ((p_to + 1)::timestamp) AT TIME ZONE 'Europe/London', '[)');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name) ORDER BY pa.name), '[]'::jsonb)
    INTO v_pitches
    FROM public.playing_areas pa
    WHERE pa.venue_id = p_venue_id AND pa.active AND pa.is_available;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'playing_area_id', po.playing_area_id,
      'start', lower(po.time_range),
      'end',   upper(po.time_range)
    ) ORDER BY lower(po.time_range)), '[]'::jsonb)
    INTO v_busy
    FROM public.pitch_occupancy po
    WHERE po.venue_id = p_venue_id AND po.active AND po.time_range && v_range;
  RETURN jsonb_build_object('ok', true, 'venue_id', p_venue_id, 'pitches', v_pitches, 'busy', v_busy);
END;
$function$;
SELECT pg_notify('pgrst', 'reload schema');
