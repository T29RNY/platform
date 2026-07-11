-- 545 DOWN: remove the per-fixture free-text location. Restores every touched function
-- to its pre-545 body (no `location` key; no venue join on the coach detail), drops the two
-- new write overloads back to their prior signatures, and drops the column LAST (after the
-- functions that SELECT it are reverted). Additive-field removal is backward-safe.

-- ── Write overloads → prior signatures ──
DROP FUNCTION IF EXISTS public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time without time zone, text);
DROP FUNCTION IF EXISTS public.venue_upsert_club_fixture(text, uuid, uuid, uuid, text, text, boolean, date, time without time zone, uuid, uuid, text, integer, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.club_manager_update_home_fixture(
  p_fixture_id uuid, p_playing_area_id uuid DEFAULT NULL::uuid, p_official_id uuid DEFAULT NULL::uuid,
  p_ref_name text DEFAULT NULL::text, p_kickoff_time time without time zone DEFAULT NULL::time without time zone)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_profile record; v_fix record;
  v_pitch_ven text; v_off_ven text; v_ref_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT cf.id, cf.club_team_id, cf.is_home, cl.club_id, cl.venue_id AS league_venue_id INTO v_fix
  FROM public.club_fixtures cf JOIN public.club_leagues cl ON cl.id = cf.league_id
  JOIN public.club_team_managers ctm ON ctm.team_id = cf.club_team_id AND ctm.member_profile_id = v_profile.id AND ctm.is_active = true
  WHERE cf.id = p_fixture_id;
  IF v_fix.id IS NULL THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;
  IF NOT v_fix.is_home THEN RAISE EXCEPTION 'away_read_only' USING ERRCODE = 'P0001'; END IF;
  IF p_playing_area_id IS NOT NULL THEN
    SELECT venue_id INTO v_pitch_ven FROM public.playing_areas WHERE id = p_playing_area_id AND active;
    IF v_pitch_ven IS NULL OR (v_pitch_ven <> v_fix.league_venue_id AND NOT public._venue_in_club_operator(v_fix.league_venue_id, v_fix.club_id, v_pitch_ven)) THEN
      RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF p_official_id IS NOT NULL THEN
    SELECT venue_id INTO v_off_ven FROM public.match_officials WHERE id = p_official_id AND active;
    IF v_off_ven IS NULL OR (v_off_ven <> v_fix.league_venue_id AND NOT public._venue_in_club_operator(v_fix.league_venue_id, v_fix.club_id, v_off_ven)) THEN
      RAISE EXCEPTION 'ref_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  END IF;
  v_ref_name := CASE WHEN p_official_id IS NOT NULL THEN NULL ELSE NULLIF(btrim(p_ref_name), '') END;
  UPDATE public.club_fixtures SET playing_area_id = p_playing_area_id, official_id = p_official_id,
    ref_name = v_ref_name, kickoff_time = p_kickoff_time, updated_at = now() WHERE id = p_fixture_id;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_fix.league_venue_id, v_uid, 'player', v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
          'club_fixture_manager_updated', 'club_fixture', p_fixture_id::text,
          jsonb_build_object('playing_area_id', p_playing_area_id, 'official_id', p_official_id, 'ref_name', v_ref_name, 'kickoff_time', p_kickoff_time));
  RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time without time zone) TO authenticated;

CREATE OR REPLACE FUNCTION public.venue_upsert_club_fixture(
  p_venue_token text, p_fixture_id uuid DEFAULT NULL::uuid, p_league_id uuid DEFAULT NULL::uuid,
  p_club_team_id uuid DEFAULT NULL::uuid, p_club_team_name text DEFAULT NULL::text, p_opponent_name text DEFAULT NULL::text,
  p_is_home boolean DEFAULT NULL::boolean, p_scheduled_date date DEFAULT NULL::date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone,
  p_playing_area_id uuid DEFAULT NULL::uuid, p_official_id uuid DEFAULT NULL::uuid, p_ref_name text DEFAULT NULL::text,
  p_home_score integer DEFAULT NULL::integer, p_away_score integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue text; v_league record; v_id uuid; v_code text; v_pitch_venue text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('scheduled','completed','postponed','void') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001'; END IF;
  IF p_official_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.match_officials WHERE id = p_official_id AND venue_id = v_venue) THEN RAISE EXCEPTION 'ref_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF p_fixture_id IS NULL THEN
    IF p_league_id IS NULL THEN RAISE EXCEPTION 'league_required' USING ERRCODE = 'P0001'; END IF;
    IF NULLIF(btrim(p_opponent_name), '') IS NULL THEN RAISE EXCEPTION 'opponent_required' USING ERRCODE = 'P0001'; END IF;
    SELECT cl.id, cl.club_id INTO v_league FROM public.club_leagues cl WHERE cl.id = p_league_id AND cl.venue_id = v_venue;
    IF v_league.id IS NULL THEN RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001'; END IF;
    IF NOT public._club_feature_enabled(v_league.club_id, 'club_leagues') THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001'; END IF;
    IF p_club_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.club_teams WHERE id = p_club_team_id AND club_id = v_league.club_id) THEN RAISE EXCEPTION 'team_not_in_club' USING ERRCODE = 'P0001'; END IF;
    IF p_playing_area_id IS NOT NULL THEN
      SELECT venue_id INTO v_pitch_venue FROM public.playing_areas WHERE id = p_playing_area_id;
      IF v_pitch_venue IS NULL OR (v_pitch_venue <> v_venue AND NOT public._venue_in_club_operator(v_venue, v_league.club_id, v_pitch_venue)) THEN RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001'; END IF;
    END IF;
    INSERT INTO public.club_fixtures (league_id, club_team_id, club_team_name, opponent_name, is_home, scheduled_date, kickoff_time, playing_area_id, official_id, ref_name, home_score, away_score, status, notes)
    VALUES (p_league_id, p_club_team_id, NULLIF(btrim(p_club_team_name), ''), btrim(p_opponent_name), COALESCE(p_is_home, true), p_scheduled_date, p_kickoff_time, p_playing_area_id, p_official_id, NULLIF(btrim(p_ref_name), ''), p_home_score, p_away_score, COALESCE(p_status, 'scheduled'), NULLIF(btrim(p_notes), ''))
    RETURNING id, share_code INTO v_id, v_code;
    INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'club_fixture_created', 'club_fixture', v_id::text, jsonb_build_object('league_id', p_league_id, 'opponent', btrim(p_opponent_name), 'pitch_venue', v_pitch_venue));
    RETURN jsonb_build_object('ok', true, 'fixture_id', v_id, 'share_code', v_code, 'created', true);
  ELSE
    SELECT f.id, f.share_code, cl.club_id INTO v_league FROM public.club_fixtures f JOIN public.club_leagues cl ON cl.id = f.league_id WHERE f.id = p_fixture_id AND cl.venue_id = v_venue;
    IF v_league.id IS NULL THEN RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001'; END IF;
    IF NOT public._club_feature_enabled(v_league.club_id, 'club_leagues') THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001'; END IF;
    IF p_club_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.club_teams WHERE id = p_club_team_id AND club_id = v_league.club_id) THEN RAISE EXCEPTION 'team_not_in_club' USING ERRCODE = 'P0001'; END IF;
    IF p_playing_area_id IS NOT NULL THEN
      SELECT venue_id INTO v_pitch_venue FROM public.playing_areas WHERE id = p_playing_area_id;
      IF v_pitch_venue IS NULL OR (v_pitch_venue <> v_venue AND NOT public._venue_in_club_operator(v_venue, v_league.club_id, v_pitch_venue)) THEN RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001'; END IF;
    END IF;
    UPDATE public.club_fixtures SET
      club_team_id = COALESCE(p_club_team_id, club_team_id), club_team_name = COALESCE(NULLIF(btrim(p_club_team_name), ''), club_team_name),
      opponent_name = COALESCE(NULLIF(btrim(p_opponent_name), ''), opponent_name), is_home = COALESCE(p_is_home, is_home),
      scheduled_date = COALESCE(p_scheduled_date, scheduled_date), kickoff_time = COALESCE(p_kickoff_time, kickoff_time),
      playing_area_id = COALESCE(p_playing_area_id, playing_area_id), official_id = COALESCE(p_official_id, official_id),
      ref_name = COALESCE(NULLIF(btrim(p_ref_name), ''), ref_name), home_score = COALESCE(p_home_score, home_score),
      away_score = COALESCE(p_away_score, away_score), status = COALESCE(p_status, status), notes = COALESCE(NULLIF(btrim(p_notes), ''), notes), updated_at = now()
    WHERE id = p_fixture_id;
    INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'club_fixture_updated', 'club_fixture', p_fixture_id::text, jsonb_build_object('status', p_status, 'pitch_venue', v_pitch_venue));
    RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id, 'share_code', v_league.share_code, 'created', false);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_upsert_club_fixture(text, uuid, uuid, uuid, text, text, boolean, date, time without time zone, uuid, uuid, text, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_upsert_club_fixture(text, uuid, uuid, uuid, text, text, boolean, date, time without time zone, uuid, uuid, text, integer, integer, text, text) TO anon, authenticated;

-- ── Options reader → prior (drop `location` from fixture object) ──
CREATE OR REPLACE FUNCTION public.club_manager_get_home_fixture_options(p_fixture_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_fix record; v_pitches jsonb; v_officials jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'profile_not_found'); END IF;
  SELECT cf.id, cf.club_team_id, cf.is_home, cf.playing_area_id, cf.official_id, cf.ref_name, cf.kickoff_time, cf.scheduled_date, cf.opponent_name, cl.club_id, cl.venue_id AS league_venue_id
    INTO v_fix
  FROM public.club_fixtures cf JOIN public.club_leagues cl ON cl.id = cf.league_id
  JOIN public.club_team_managers ctm ON ctm.team_id = cf.club_team_id AND ctm.member_profile_id = v_profile_id AND ctm.is_active = true
  WHERE cf.id = p_fixture_id;
  IF v_fix.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_manager'); END IF;
  IF NOT v_fix.is_home THEN RETURN jsonb_build_object('ok', false, 'reason', 'away_read_only'); END IF;
  WITH allowed AS (
    SELECT v_fix.league_venue_id AS venue_id
    UNION
    SELECT cv.venue_id FROM public.club_venues cv JOIN public.venues tv ON tv.id = cv.venue_id
    WHERE cv.club_id = v_fix.club_id AND tv.company_id IS NOT NULL AND tv.company_id = (SELECT company_id FROM public.venues WHERE id = v_fix.league_venue_id)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name, 'venue_id', pa.venue_id, 'venue_name', v.name) ORDER BY v.name, pa.sort_order, pa.name)
              FROM public.playing_areas pa JOIN public.venues v ON v.id = pa.venue_id WHERE pa.venue_id IN (SELECT venue_id FROM allowed) AND pa.active), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', mo.id, 'name', mo.name, 'venue_id', mo.venue_id, 'venue_name', v.name) ORDER BY v.name, mo.name)
              FROM public.match_officials mo JOIN public.venues v ON v.id = mo.venue_id WHERE mo.venue_id IN (SELECT venue_id FROM allowed) AND mo.active), '[]'::jsonb)
  INTO v_pitches, v_officials;
  RETURN jsonb_build_object('ok', true,
    'fixture', jsonb_build_object('fixture_id', v_fix.id, 'opponent_name', v_fix.opponent_name, 'scheduled_date', v_fix.scheduled_date,
      'kickoff_time', to_char(v_fix.kickoff_time, 'HH24:MI'), 'playing_area_id', v_fix.playing_area_id, 'official_id', v_fix.official_id, 'ref_name', v_fix.ref_name),
    'pitches', v_pitches, 'officials', v_officials);
END;
$function$;

-- ── Coach detail → prior (no location, no venue join) ──
CREATE OR REPLACE FUNCTION public.club_manager_get_fixture_detail(p_fixture_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_team_id uuid := public._club_manager_fixture_team(p_fixture_id); v_fx record; v_roster jsonb; v_stats jsonb;
BEGIN
  SELECT cf.id, cf.opponent_name, cf.is_home, cf.scheduled_date, to_char(cf.kickoff_time,'HH24:MI') AS kickoff_time,
         cf.home_score, cf.away_score, cf.status, cf.club_team_id, COALESCE(cf.club_team_name, ct.name) AS our_team
    INTO v_fx FROM club_fixtures cf LEFT JOIN club_teams ct ON ct.id = cf.club_team_id WHERE cf.id = p_fixture_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('member_profile_id', mp.id, 'name', mp.first_name || COALESCE(' ' || mp.last_name, ''),
           'status', COALESCE(fa.status, 'pending'), 'is_starter', ln.is_starter, 'position', ln.position, 'selected', (ln.member_profile_id IS NOT NULL)) ORDER BY mp.first_name), '[]'::jsonb)
    INTO v_roster FROM club_team_members cm JOIN member_profiles mp ON mp.id = cm.member_profile_id
    LEFT JOIN club_fixture_availability fa ON fa.fixture_id = p_fixture_id AND fa.member_profile_id = cm.member_profile_id
    LEFT JOIN club_fixture_lineups ln ON ln.fixture_id = p_fixture_id AND ln.member_profile_id = cm.member_profile_id
   WHERE cm.team_id = v_team_id AND cm.is_active = true;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('member_profile_id', s.member_profile_id, 'goals', s.goals, 'assists', s.assists,
           'yellow_cards', s.yellow_cards, 'red_cards', s.red_cards, 'minutes', s.minutes, 'is_potm', s.is_potm)), '[]'::jsonb)
    INTO v_stats FROM club_fixture_player_stats s WHERE s.fixture_id = p_fixture_id;
  RETURN jsonb_build_object('ok', true,
    'fixture', jsonb_build_object('fixture_id', v_fx.id, 'opponent_name', v_fx.opponent_name, 'is_home', v_fx.is_home, 'scheduled_date', v_fx.scheduled_date,
      'kickoff_time', v_fx.kickoff_time, 'home_score', v_fx.home_score, 'away_score', v_fx.away_score, 'status', v_fx.status, 'our_team', v_fx.our_team, 'team_id', v_fx.club_team_id),
    'roster', v_roster, 'stats', v_stats);
END;
$function$;

-- ── guardian_list_child_fixtures → prior (drop `location`; keep venue_address) ──
CREATE OR REPLACE FUNCTION public.guardian_list_child_fixtures(p_child_profile_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_caller_profile uuid; v_upcoming jsonb; v_recent jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_caller_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001'; END IF;
  IF p_child_profile_id <> v_caller_profile AND NOT EXISTS (SELECT 1 FROM public.member_guardians WHERE guardian_profile_id = v_caller_profile AND child_profile_id = p_child_profile_id AND invite_state = 'accepted') THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'scheduled_date'), (row_obj->>'kickoff_time')), '[]'::jsonb) INTO v_upcoming
  FROM (
    SELECT jsonb_build_object('fixture_id', cf.id, 'league_id', cf.league_id, 'league_name', cl.name, 'club_team_id', cf.club_team_id,
      'club_team_name', COALESCE(cf.club_team_name, ct.name), 'opponent_name', cf.opponent_name, 'is_home', cf.is_home,
      'scheduled_date', cf.scheduled_date, 'kickoff_time', to_char(cf.kickoff_time, 'HH24:MI'), 'pitch_name', pa.name, 'venue_name', v.name,
      'venue_address', NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''), 'ref_name', COALESCE(mo.name, cf.ref_name), 'status', cf.status, 'own_rsvp_status', a.status,
      'counts', (SELECT jsonb_build_object('in', count(*) FILTER (WHERE COALESCE(av.status, 'pending') = 'in'), 'out', count(*) FILTER (WHERE COALESCE(av.status, 'pending') = 'out'),
          'maybe', count(*) FILTER (WHERE COALESCE(av.status, 'pending') = 'maybe'), 'pending', count(*) FILTER (WHERE COALESCE(av.status, 'pending') = 'pending'), 'total', count(*))
        FROM public.club_team_members m LEFT JOIN public.club_fixture_availability av ON av.fixture_id = cf.id AND av.member_profile_id = m.member_profile_id WHERE m.team_id = cf.club_team_id AND m.is_active = true)
    ) AS row_obj
    FROM public.club_fixtures cf
    JOIN public.club_team_members ctm ON ctm.team_id = cf.club_team_id AND ctm.member_profile_id = p_child_profile_id AND ctm.is_active = true
    LEFT JOIN public.club_leagues cl ON cl.id = cf.league_id LEFT JOIN public.club_teams ct ON ct.id = cf.club_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = cf.playing_area_id LEFT JOIN public.venues v ON v.id = pa.venue_id
    LEFT JOIN public.match_officials mo ON mo.id = cf.official_id
    LEFT JOIN public.club_fixture_availability a ON a.fixture_id = cf.id AND a.member_profile_id = p_child_profile_id
    WHERE cf.status = 'scheduled' AND cf.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date
  ) up;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'scheduled_date') DESC), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT jsonb_build_object('fixture_id', cf.id, 'league_id', cf.league_id, 'league_name', cl.name, 'club_team_id', cf.club_team_id,
      'club_team_name', COALESCE(cf.club_team_name, ct.name), 'opponent_name', cf.opponent_name, 'is_home', cf.is_home,
      'scheduled_date', cf.scheduled_date, 'kickoff_time', to_char(cf.kickoff_time, 'HH24:MI'), 'home_score', cf.home_score, 'away_score', cf.away_score, 'status', cf.status) AS row_obj
    FROM public.club_fixtures cf
    JOIN public.club_team_members ctm ON ctm.team_id = cf.club_team_id AND ctm.member_profile_id = p_child_profile_id AND ctm.is_active = true
    LEFT JOIN public.club_leagues cl ON cl.id = cf.league_id LEFT JOIN public.club_teams ct ON ct.id = cf.club_team_id
    WHERE cf.status = 'completed' ORDER BY cf.scheduled_date DESC LIMIT 6
  ) rec;
  RETURN jsonb_build_object('ok', true, 'child_profile_id', p_child_profile_id, 'upcoming', v_upcoming, 'recent', v_recent);
END;
$function$;
REVOKE ALL ON FUNCTION public.guardian_list_child_fixtures(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardian_list_child_fixtures(uuid) TO anon, authenticated;

-- ── guardian_list_child_leagues → prior (drop `location` from fixtures[]+results[]) ──
CREATE OR REPLACE FUNCTION public.guardian_list_child_leagues(p_child_profile_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_caller_profile uuid; v_today date := (now() AT TIME ZONE 'Europe/London')::date; v_leagues jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_caller_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_caller_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE = 'P0001'; END IF;
  IF p_child_profile_id <> v_caller_profile AND NOT EXISTS (SELECT 1 FROM public.member_guardians WHERE guardian_profile_id = v_caller_profile AND child_profile_id = p_child_profile_id AND invite_state = 'accepted') THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = 'P0001'; END IF;
  WITH child_teams AS (
    SELECT DISTINCT ctm.team_id, cf.league_id FROM public.club_team_members ctm JOIN public.club_fixtures cf ON cf.club_team_id = ctm.team_id WHERE ctm.member_profile_id = p_child_profile_id AND ctm.is_active = true
  ),
  played AS (
    SELECT ct.team_id, ct.league_id, cf.scheduled_date, (CASE WHEN cf.is_home THEN cf.home_score ELSE cf.away_score END) AS us, (CASE WHEN cf.is_home THEN cf.away_score ELSE cf.home_score END) AS them
    FROM child_teams ct JOIN public.club_fixtures cf ON cf.club_team_id = ct.team_id AND cf.league_id = ct.league_id WHERE cf.status = 'completed' AND cf.home_score IS NOT NULL AND cf.away_score IS NOT NULL
  ),
  form AS (
    SELECT team_id, league_id, COUNT(*) AS played, COUNT(*) FILTER (WHERE us > them) AS won, COUNT(*) FILTER (WHERE us = them) AS drawn, COUNT(*) FILTER (WHERE us < them) AS lost,
      COALESCE(SUM(us), 0) AS gf, COALESCE(SUM(them), 0) AS ga, COALESCE(SUM(us - them), 0) AS gd, COALESCE(SUM(CASE WHEN us > them THEN 3 WHEN us = them THEN 1 ELSE 0 END), 0) AS points FROM played GROUP BY team_id, league_id
  ),
  last5 AS (
    SELECT team_id, league_id, jsonb_agg(r ORDER BY rn DESC) AS chips FROM (
      SELECT team_id, league_id, (CASE WHEN us > them THEN 'W' WHEN us = them THEN 'D' ELSE 'L' END) AS r, row_number() OVER (PARTITION BY team_id, league_id ORDER BY scheduled_date DESC) AS rn FROM played
    ) q WHERE rn <= 5 GROUP BY team_id, league_id
  )
  SELECT COALESCE(jsonb_agg(block ORDER BY league_name), '[]'::jsonb) INTO v_leagues
  FROM (
    SELECT cl.name AS league_name, jsonb_build_object('league_id', cl.id, 'league_name', cl.name, 'season_label', cl.season_label, 'club_name', c.name, 'fa_embed_code', cl.fa_embed_code, 'fa_source_url', cl.fa_source_url,
      'club_team_id', t.id, 'club_team_name', t.name,
      'form', jsonb_build_object('played', COALESCE(f.played, 0), 'won', COALESCE(f.won, 0), 'drawn', COALESCE(f.drawn, 0), 'lost', COALESCE(f.lost, 0), 'gf', COALESCE(f.gf, 0), 'ga', COALESCE(f.ga, 0), 'gd', COALESCE(f.gd, 0), 'points', COALESCE(f.points, 0), 'last5', COALESCE(l5.chips, '[]'::jsonb)),
      'fixtures', COALESCE((SELECT jsonb_agg(jsonb_build_object('fixture_id', cf.id, 'opponent_name', cf.opponent_name, 'is_home', cf.is_home, 'scheduled_date', cf.scheduled_date, 'kickoff_time', to_char(cf.kickoff_time, 'HH24:MI'),
          'pitch_name', pa.name, 'venue_name', vn.name, 'venue_address', NULLIF(concat_ws(', ', vn.address, vn.city, vn.postcode), ''), 'ref_name', COALESCE(mo.name, cf.ref_name), 'status', cf.status) ORDER BY cf.scheduled_date, cf.kickoff_time)
        FROM public.club_fixtures cf LEFT JOIN public.playing_areas pa ON pa.id = cf.playing_area_id LEFT JOIN public.venues vn ON vn.id = pa.venue_id LEFT JOIN public.match_officials mo ON mo.id = cf.official_id
        WHERE cf.club_team_id = ct.team_id AND cf.league_id = ct.league_id AND cf.status = 'scheduled' AND cf.scheduled_date >= v_today), '[]'::jsonb),
      'results', COALESCE((SELECT jsonb_agg(jsonb_build_object('fixture_id', cf.id, 'opponent_name', cf.opponent_name, 'is_home', cf.is_home, 'scheduled_date', cf.scheduled_date, 'kickoff_time', to_char(cf.kickoff_time, 'HH24:MI'),
          'pitch_name', pa.name, 'venue_name', vn.name, 'venue_address', NULLIF(concat_ws(', ', vn.address, vn.city, vn.postcode), ''), 'ref_name', COALESCE(mo.name, cf.ref_name), 'home_score', cf.home_score, 'away_score', cf.away_score, 'status', cf.status) ORDER BY cf.scheduled_date DESC)
        FROM public.club_fixtures cf LEFT JOIN public.playing_areas pa ON pa.id = cf.playing_area_id LEFT JOIN public.venues vn ON vn.id = pa.venue_id LEFT JOIN public.match_officials mo ON mo.id = cf.official_id
        WHERE cf.club_team_id = ct.team_id AND cf.league_id = ct.league_id AND cf.status = 'completed'), '[]'::jsonb)
    ) AS block
    FROM child_teams ct JOIN public.club_leagues cl ON cl.id = ct.league_id AND cl.archived_at IS NULL JOIN public.clubs c ON c.id = cl.club_id JOIN public.club_teams t ON t.id = ct.team_id
    LEFT JOIN form f ON f.team_id = ct.team_id AND f.league_id = ct.league_id LEFT JOIN last5 l5 ON l5.team_id = ct.team_id AND l5.league_id = ct.league_id
  ) blocks;
  RETURN jsonb_build_object('ok', true, 'child_profile_id', p_child_profile_id, 'leagues', COALESCE(v_leagues, '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.guardian_list_child_leagues(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardian_list_child_leagues(uuid) TO anon, authenticated;

-- ── club_manager_list_team_fixtures → prior (drop `location`, `venue_address`) ──
CREATE OR REPLACE FUNCTION public.club_manager_list_team_fixtures()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile uuid; v_teams jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id', ct.id, 'team_name', ct.name, 'club_id', ct.club_id, 'upcoming', up.upcoming, 'recent', rc.recent) ORDER BY ct.name), '[]'::jsonb) INTO v_teams
  FROM club_team_managers ctm JOIN club_teams ct ON ct.id = ctm.team_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(fx ORDER BY (fx->>'scheduled_date') NULLS LAST, (fx->>'kickoff_time')), '[]'::jsonb) AS upcoming FROM (
      SELECT jsonb_build_object('fixture_id', cf.id, 'opponent_name', cf.opponent_name, 'is_home', cf.is_home, 'scheduled_date', cf.scheduled_date, 'kickoff_time', to_char(cf.kickoff_time, 'HH24:MI'),
        'league_name', cl.name, 'pitch_name', pa.name, 'venue_name', v.name, 'ref_name', COALESCE(mo.name, cf.ref_name), 'notes', cf.notes, 'source', cf.source, 'status', cf.status, 'counts', av.counts, 'roster', av.roster) AS fx
      FROM club_fixtures cf LEFT JOIN club_leagues cl ON cl.id = cf.league_id LEFT JOIN playing_areas pa ON pa.id = cf.playing_area_id LEFT JOIN venues v ON v.id = pa.venue_id LEFT JOIN match_officials mo ON mo.id = cf.official_id
      CROSS JOIN LATERAL (
        SELECT jsonb_build_object('in', count(*) FILTER (WHERE st = 'in'), 'out', count(*) FILTER (WHERE st = 'out'), 'maybe', count(*) FILTER (WHERE st = 'maybe'), 'pending', count(*) FILTER (WHERE st = 'pending'), 'total', count(*)) AS counts,
          COALESCE(jsonb_agg(jsonb_build_object('member_profile_id', pid, 'name', nm, 'status', st) ORDER BY nm), '[]'::jsonb) AS roster
        FROM (SELECT m.member_profile_id AS pid, btrim(concat_ws(' ', mp.first_name, mp.last_name)) AS nm, COALESCE(a.status, 'pending') AS st
          FROM club_team_members m JOIN member_profiles mp ON mp.id = m.member_profile_id LEFT JOIN club_fixture_availability a ON a.fixture_id = cf.id AND a.member_profile_id = m.member_profile_id WHERE m.team_id = ct.id AND m.is_active = true) r
      ) av
      WHERE cf.club_team_id = ct.id AND cf.status = 'scheduled' AND (cf.scheduled_date IS NULL OR cf.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date)
    ) up_inner
  ) up
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(fx ORDER BY (fx->>'scheduled_date') DESC), '[]'::jsonb) AS recent FROM (
      SELECT jsonb_build_object('fixture_id', cf.id, 'opponent_name', cf.opponent_name, 'is_home', cf.is_home, 'scheduled_date', cf.scheduled_date, 'kickoff_time', to_char(cf.kickoff_time, 'HH24:MI'),
        'home_score', cf.home_score, 'away_score', cf.away_score, 'league_name', cl.name, 'source', cf.source, 'status', cf.status) AS fx
      FROM club_fixtures cf LEFT JOIN club_leagues cl ON cl.id = cf.league_id WHERE cf.club_team_id = ct.id AND cf.status = 'completed' ORDER BY cf.scheduled_date DESC NULLS LAST LIMIT 6
    ) rec_inner
  ) rc
  WHERE ctm.member_profile_id = v_profile AND ctm.is_active = true;
  IF v_teams = '[]'::jsonb THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001'; END IF;
  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END;
$function$;
REVOKE ALL ON FUNCTION public.club_manager_list_team_fixtures() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_list_team_fixtures() TO authenticated;

-- ── member_list_club_fixtures → prior (drop `location`, `venue_address`) ──
CREATE OR REPLACE FUNCTION public.member_list_club_fixtures(p_club_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'fixture_id', cf.id, 'is_fixture', true, 'league_id', cf.league_id, 'league_name', cl.name,
        'club_team_id', cf.club_team_id, 'team_id', cf.club_team_id, 'club_team_name', cf.club_team_name,
        'opponent_name', cf.opponent_name, 'is_home', cf.is_home,
        'home_away', CASE WHEN cf.is_home THEN 'home' ELSE 'away' END, 'session_type', 'match',
        'title', 'vs ' || cf.opponent_name, 'scheduled_date', cf.scheduled_date, 'kickoff_time', cf.kickoff_time,
        'scheduled_at', CASE WHEN cf.scheduled_date IS NULL THEN NULL
                             ELSE (cf.scheduled_date + COALESCE(cf.kickoff_time, TIME '00:00')) AT TIME ZONE 'Europe/London' END,
        'playing_area_id', cf.playing_area_id, 'pitch_name', pa.name, 'venue_id', pa.venue_id, 'venue_name', v.name,
        'ref_name', cf.ref_name, 'status', cf.status, 'share_code', cf.share_code, 'notes', cf.notes
      ) ORDER BY cf.scheduled_date NULLS LAST, cf.kickoff_time NULLS LAST
    )
    FROM public.club_fixtures cf
    JOIN public.club_teams ct ON ct.id = cf.club_team_id AND ct.club_id = p_club_id
    JOIN public.club_team_managers ctm ON ctm.team_id = cf.club_team_id AND ctm.member_profile_id = v_profile_id AND ctm.is_active = true
    LEFT JOIN public.club_leagues cl ON cl.id = cf.league_id
    LEFT JOIN public.playing_areas pa ON pa.id = cf.playing_area_id
    LEFT JOIN public.venues v ON v.id = pa.venue_id
    WHERE cf.status = 'scheduled' AND (cf.scheduled_date IS NULL OR cf.scheduled_date >= current_date)
  ), '[]'::jsonb);
END;
$function$;

-- ── venue_list_club_fixtures → prior (drop `location`; venue_address predates 545) ──
CREATE OR REPLACE FUNCTION public.venue_list_club_fixtures(p_venue_token text, p_league_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue text; v_out jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue := v_caller.venue_id;
  IF NOT EXISTS (SELECT 1 FROM public.club_leagues WHERE id = p_league_id AND venue_id = v_venue) THEN RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(jsonb_agg(row ORDER BY sd, kt), '[]'::jsonb) INTO v_out FROM (
    SELECT f.scheduled_date AS sd, f.kickoff_time AS kt,
           jsonb_build_object(
             'fixture_id', f.id, 'league_id', f.league_id, 'club_team_id', f.club_team_id,
             'club_team_name', COALESCE(f.club_team_name, ct.name),
             'opponent_name', f.opponent_name, 'is_home', f.is_home,
             'scheduled_date', f.scheduled_date, 'kickoff_time', to_char(f.kickoff_time, 'HH24:MI'),
             'playing_area_id', f.playing_area_id, 'pitch_name', pa.name,
             'venue_id', v.id, 'venue_name', v.name,
             'venue_address', NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
             'official_id', f.official_id, 'referee_name', COALESCE(mo.name, f.ref_name),
             'home_score', f.home_score, 'away_score', f.away_score,
             'status', f.status, 'share_code', f.share_code, 'source', f.source, 'notes', f.notes
           ) AS row
    FROM public.club_fixtures f
    JOIN public.club_leagues cl ON cl.id = f.league_id
    LEFT JOIN public.club_teams ct ON ct.id = f.club_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.venues v ON v.id = COALESCE(pa.venue_id, cl.venue_id)
    LEFT JOIN public.match_officials mo ON mo.id = f.official_id
    WHERE f.league_id = p_league_id
  ) s;
  RETURN jsonb_build_object('ok', true, 'fixtures', v_out);
END;
$function$;

-- ── Finally drop the column (all readers reverted above no longer reference it) ──
ALTER TABLE public.club_fixtures DROP COLUMN IF EXISTS location;
