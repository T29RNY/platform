-- 415_split_club_leagues_feature_flag_down.sql
-- Reverse of 415: restore the pre-415 (competition-only) flag plumbing + guards,
-- then drop the club_leagues column. Restore functions BEFORE dropping the column
-- (they must stop referencing it first).

-- ─── Reverse the 4 guard swaps: club_leagues → competition ────────────────────
DO $mig$
DECLARE r record; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('venue_create_club_league','venue_update_club_league',
                        'venue_delete_club_fixture','venue_set_matchday_info')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '''club_leagues''', '''competition''');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END
$mig$;

-- ─── Restore venue_upsert_club_fixture (pre-415 = Phase-2 mig-413 body, NO guard) ──
CREATE OR REPLACE FUNCTION public.venue_upsert_club_fixture(
  p_venue_token text, p_fixture_id uuid DEFAULT NULL, p_league_id uuid DEFAULT NULL,
  p_club_team_id uuid DEFAULT NULL, p_club_team_name text DEFAULT NULL, p_opponent_name text DEFAULT NULL,
  p_is_home boolean DEFAULT NULL, p_scheduled_date date DEFAULT NULL, p_kickoff_time time DEFAULT NULL,
  p_playing_area_id uuid DEFAULT NULL, p_official_id uuid DEFAULT NULL, p_ref_name text DEFAULT NULL,
  p_home_score integer DEFAULT NULL, p_away_score integer DEFAULT NULL, p_status text DEFAULT NULL,
  p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue text; v_league record; v_id uuid; v_code text; v_pitch_venue text;
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
      away_score = COALESCE(p_away_score, away_score), status = COALESCE(p_status, status),
      notes = COALESCE(NULLIF(btrim(p_notes), ''), notes), updated_at = now()
    WHERE id = p_fixture_id;
    INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'club_fixture_updated', 'club_fixture', p_fixture_id::text, jsonb_build_object('status', p_status, 'pitch_venue', v_pitch_venue));
    RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id, 'share_code', v_league.share_code, 'created', false);
  END IF;
END;
$function$;

-- ─── Restore _club_feature_enabled (drop club_leagues case) ───────────────────
CREATE OR REPLACE FUNCTION public._club_feature_enabled(p_club_id text, p_feature text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT CASE p_feature
              WHEN 'memberships' THEN cf.memberships
              WHEN 'competition' THEN cf.competition
              WHEN 'coaching'    THEN cf.coaching
              WHEN 'tournaments' THEN cf.tournaments
              WHEN 'public_web'  THEN cf.public_web
            END
     FROM public.club_features cf WHERE cf.club_id = p_club_id),
    true);
$function$;

-- ─── Restore get_venue_feature_flags (no club_leagues) ────────────────────────
CREATE OR REPLACE FUNCTION public.get_venue_feature_flags(p_credential text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_vf record; v_cf record; v_disc jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  v_venue_id := v_caller.venue_id;
  IF v_venue_id IS NULL THEN
    RETURN jsonb_build_object('bookings', true, 'spaces', true, 'room_hire', true, 'equipment', true,
      'memberships', true, 'competition', true, 'coaching', true, 'tournaments', true, 'public_web', true, 'disciplines', '[]'::jsonb);
  END IF;
  SELECT COALESCE(vf.bookings, true) AS bookings, COALESCE(vf.spaces, true) AS spaces, COALESCE(vf.room_hire, true) AS room_hire, COALESCE(vf.equipment, true) AS equipment
    INTO v_vf FROM (SELECT v_venue_id AS venue_id) base LEFT JOIN public.venue_features vf ON vf.venue_id = base.venue_id;
  SELECT COALESCE(bool_or(COALESCE(cf.memberships, true)), true) AS memberships, COALESCE(bool_or(COALESCE(cf.competition, true)), true) AS competition,
         COALESCE(bool_or(COALESCE(cf.coaching, true)), true) AS coaching, COALESCE(bool_or(COALESCE(cf.tournaments, true)), true) AS tournaments,
         COALESCE(bool_or(COALESCE(cf.public_web, true)), true) AS public_web
    INTO v_cf FROM public.club_venues cv LEFT JOIN public.club_features cf ON cf.club_id = cv.club_id WHERE cv.venue_id = v_venue_id;
  SELECT COALESCE(jsonb_agg(DISTINCT c.discipline) FILTER (WHERE c.discipline IS NOT NULL), '[]'::jsonb)
    INTO v_disc FROM public.club_venues cv JOIN public.clubs c ON c.id = cv.club_id WHERE cv.venue_id = v_venue_id;
  RETURN jsonb_build_object('bookings', v_vf.bookings, 'spaces', v_vf.spaces, 'room_hire', v_vf.room_hire, 'equipment', v_vf.equipment,
    'memberships', COALESCE(v_cf.memberships, true), 'competition', COALESCE(v_cf.competition, true), 'coaching', COALESCE(v_cf.coaching, true),
    'tournaments', COALESCE(v_cf.tournaments, true), 'public_web', COALESCE(v_cf.public_web, true), 'disciplines', v_disc);
END;
$function$;

-- ─── Restore venue_get_feature_settings (no club_leagues) ─────────────────────
CREATE OR REPLACE FUNCTION public.venue_get_feature_settings(p_venue_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_venue jsonb; v_clubs jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  SELECT jsonb_build_object('bookings', COALESCE(vf.bookings, true), 'spaces', COALESCE(vf.spaces, true), 'room_hire', COALESCE(vf.room_hire, true), 'equipment', COALESCE(vf.equipment, true))
    INTO v_venue FROM (SELECT v_venue_id AS venue_id) base LEFT JOIN public.venue_features vf ON vf.venue_id = base.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('club_id', c.id, 'name', c.name, 'discipline', c.discipline,
           'memberships', COALESCE(cf.memberships, true), 'competition', COALESCE(cf.competition, true),
           'coaching', COALESCE(cf.coaching, true), 'tournaments', COALESCE(cf.tournaments, true), 'public_web', COALESCE(cf.public_web, true)) ORDER BY c.name), '[]'::jsonb)
    INTO v_clubs FROM public.club_venues cv JOIN public.clubs c ON c.id = cv.club_id LEFT JOIN public.club_features cf ON cf.club_id = c.id WHERE cv.venue_id = v_venue_id;
  RETURN jsonb_build_object('venue', v_venue, 'clubs', v_clubs);
END;
$function$;

-- ─── Restore venue_set_club_feature (no club_leagues) ─────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_club_feature(p_venue_token text, p_club_id text, p_feature text, p_enabled boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_linked boolean; v_coaching boolean; v_row record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF p_club_id IS NULL THEN RAISE EXCEPTION 'club_id_required' USING ERRCODE = 'P0001'; END IF;
  IF p_feature IS NULL OR p_feature NOT IN ('memberships','competition','coaching','tournaments','public_web') THEN RAISE EXCEPTION 'invalid_feature' USING ERRCODE = 'P0001'; END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'enabled_required' USING ERRCODE = 'P0001'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.club_venues cv WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id) INTO v_linked;
  IF NOT v_linked THEN RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.club_features (club_id) VALUES (p_club_id) ON CONFLICT (club_id) DO NOTHING;
  IF p_feature = 'memberships' AND NOT p_enabled THEN
    SELECT coaching INTO v_coaching FROM public.club_features WHERE club_id = p_club_id;
    IF COALESCE(v_coaching, true) THEN RAISE EXCEPTION 'dependency_required' USING ERRCODE = 'P0001', DETAIL = 'coaching_requires_memberships'; END IF;
  END IF;
  UPDATE public.club_features SET
    memberships = CASE WHEN p_feature = 'memberships' THEN p_enabled WHEN p_feature = 'coaching' AND p_enabled THEN true ELSE memberships END,
    coaching = CASE WHEN p_feature = 'coaching' THEN p_enabled ELSE coaching END,
    competition = CASE WHEN p_feature = 'competition' THEN p_enabled ELSE competition END,
    tournaments = CASE WHEN p_feature = 'tournaments' THEN p_enabled ELSE tournaments END,
    public_web = CASE WHEN p_feature = 'public_web' THEN p_enabled ELSE public_web END,
    updated_at = now()
  WHERE club_id = p_club_id RETURNING * INTO v_row;
  DELETE FROM public.club_features WHERE club_id = p_club_id AND memberships AND competition AND coaching AND tournaments AND public_web;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'club_feature_toggled', 'club_feature', p_club_id,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', p_club_id, 'feature', p_feature, 'enabled', p_enabled, 'auto_enabled_memberships', (p_feature = 'coaching' AND p_enabled)));
  RETURN jsonb_build_object('ok', true, 'scope', 'club', 'club_id', p_club_id, 'feature', p_feature, 'enabled', p_enabled,
    'applied', jsonb_build_object('memberships', COALESCE(v_row.memberships, true), 'competition', COALESCE(v_row.competition, true), 'coaching', COALESCE(v_row.coaching, true), 'tournaments', COALESCE(v_row.tournaments, true), 'public_web', COALESCE(v_row.public_web, true)));
END;
$function$;

-- ─── Restore venue_set_club_features (no club_leagues) ────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_club_features(p_venue_token text, p_club_id text, p_flags jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_linked boolean; v_bad text; v_cur record;
  t_mem boolean; t_comp boolean; t_coach boolean; t_tourn boolean; t_pub boolean;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF p_club_id IS NULL THEN RAISE EXCEPTION 'club_id_required' USING ERRCODE = 'P0001'; END IF;
  IF p_flags IS NULL OR jsonb_typeof(p_flags) <> 'object' THEN RAISE EXCEPTION 'flags_required' USING ERRCODE = 'P0001'; END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_flags) k WHERE k NOT IN ('memberships','competition','coaching','tournaments','public_web') LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'invalid_feature' USING ERRCODE = 'P0001', DETAIL = v_bad; END IF;
  SELECT EXISTS (SELECT 1 FROM public.club_venues cv WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id) INTO v_linked;
  IF NOT v_linked THEN RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.club_features (club_id) VALUES (p_club_id) ON CONFLICT (club_id) DO NOTHING;
  SELECT * INTO v_cur FROM public.club_features WHERE club_id = p_club_id;
  t_mem := COALESCE((p_flags->>'memberships')::boolean, v_cur.memberships);
  t_comp := COALESCE((p_flags->>'competition')::boolean, v_cur.competition);
  t_coach := COALESCE((p_flags->>'coaching')::boolean, v_cur.coaching);
  t_tourn := COALESCE((p_flags->>'tournaments')::boolean, v_cur.tournaments);
  t_pub := COALESCE((p_flags->>'public_web')::boolean, v_cur.public_web);
  IF t_coach THEN t_mem := true; END IF;
  UPDATE public.club_features SET memberships = t_mem, competition = t_comp, coaching = t_coach, tournaments = t_tourn, public_web = t_pub, updated_at = now() WHERE club_id = p_club_id;
  DELETE FROM public.club_features WHERE club_id = p_club_id AND memberships AND competition AND coaching AND tournaments AND public_web;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'club_features_set', 'club_feature', p_club_id,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', p_club_id, 'flags', p_flags, 'coaching_forced_memberships', (t_coach AND COALESCE((p_flags->>'memberships')::boolean, true) = false)));
  RETURN jsonb_build_object('ok', true, 'scope', 'club', 'club_id', p_club_id,
    'applied', jsonb_build_object('memberships', t_mem, 'competition', t_comp, 'coaching', t_coach, 'tournaments', t_tourn, 'public_web', t_pub));
END;
$function$;

-- ─── Drop the column last ─────────────────────────────────────────────────────
ALTER TABLE public.club_features DROP COLUMN IF EXISTS club_leagues;

SELECT pg_notify('pgrst', 'reload schema');
