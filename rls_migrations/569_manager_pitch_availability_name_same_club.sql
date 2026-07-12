-- 569_manager_pitch_availability_name_same_club.sql
-- Manager booking calendar — P1 of the desktop-calendar epic: reconcile the Manager and
-- Admin calendar views (operator: "they aren't matching"). The Admin/venue calendar names
-- every team; the Manager calendar anonymised same-club teams as "In use". Anonymisation
-- only makes sense against ANOTHER operator's hire — within the SAME club a Manager should
-- see "U7 Dortmund Training" and home fixtures "PA Sports Mens v Bedworth" by name.
--
-- Change (busy[] only, additive): join same-club club_sessions (ANY team of this club, not
-- just p_team_id) + same-club home club_fixtures, and emit a `label`:
--   • own team's session   → title (or team name); is_own=true (tappable → edit/cancel)
--   • same-club other team → team name / title; is_own=false (named, not editable here)
--   • same-club home match  → "<club_team_name> v <opponent_name>"; is_own=false
--   • anything else (other operator's hire / maintenance) → label NULL → renders "In use"
-- is_own now means strictly "this manager's own team" (only those carry session_id/series_id
-- so only they are editable). The CASE-guarded ::uuid cast still avoids casting non-club
-- source_ids. READ-only, SECDEF, authenticated-only, anon revoked — unchanged.

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
      'end',   upper(po.time_range),
      'source_kind',   po.source_kind,
      'is_own',        (cs.team_id = p_team_id),
      'session_id',    CASE WHEN cs.team_id = p_team_id THEN cs.id        ELSE NULL END,
      'series_id',     CASE WHEN cs.team_id = p_team_id THEN cs.series_id ELSE NULL END,
      'duration_mins', cs.duration_mins,
      'pitch_status',  cs.pitch_status,
      'title',         cs.title,
      'label',         COALESCE(
                         CASE WHEN cs.id IS NOT NULL THEN COALESCE(NULLIF(btrim(cs.title), ''), ct.name) END,
                         CASE WHEN cft.id IS NOT NULL THEN cf.club_team_name || ' v ' || COALESCE(NULLIF(cf.opponent_name, ''), 'TBC') END
                       )
    ) ORDER BY lower(po.time_range)), '[]'::jsonb)
    INTO v_busy
    FROM public.pitch_occupancy po
    LEFT JOIN public.club_sessions cs
      ON cs.id = CASE WHEN po.source_kind = 'club_session' THEN po.source_id::uuid ELSE NULL END
     AND cs.club_id = v_club
    LEFT JOIN public.club_teams ct ON ct.id = cs.team_id
    LEFT JOIN public.club_fixtures cf
      ON cf.id = CASE WHEN po.source_kind = 'club_fixture' THEN po.source_id::uuid ELSE NULL END
    LEFT JOIN public.club_teams cft ON cft.id = cf.club_team_id AND cft.club_id = v_club
    WHERE po.venue_id = p_venue_id AND po.active AND po.time_range && v_range;
  RETURN jsonb_build_object('ok', true, 'venue_id', p_venue_id, 'pitches', v_pitches, 'busy', v_busy);
END;
$function$;
REVOKE ALL     ON FUNCTION public.club_manager_pitch_availability(uuid,text,date,date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_pitch_availability(uuid,text,date,date) TO authenticated;
SELECT pg_notify('pgrst', 'reload schema');
