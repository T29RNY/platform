-- 564_away_fixture_edit.sql
-- Manager fixture editing — allow AWAY fixtures to be edited (operator decision 2026-07-12).
--
-- BEFORE: both `club_manager_get_home_fixture_options` and `club_manager_update_home_fixture`
-- hard-blocked away fixtures ('away_read_only'), so a Manager could edit a HOME fixture's
-- pitch/ref/kick-off/location but an AWAY fixture was entirely read-only. Operator: away
-- fixtures must be editable too.
--
-- AFTER: a Manager may set an away fixture's **kick-off time, location/meeting point, and
-- notes** — the things they coordinate for their own players. The **pitch and referee stay
-- HOME-only** (an away game is at the opponent's ground — the Manager can't reserve their
-- pitch or assign their ref). Opponent / date / home-away stay league-owned (unchanged).
-- Also adds an editable **notes** field for BOTH home and away.
--
-- Two live functions change (home path kept byte-for-byte in behaviour — this surface is
-- LIVE for real Managers, so the home edit must not regress):
--   * club_manager_get_home_fixture_options — away no longer returns ok:false; returns
--     ok:true with the fixture (+ is_home:false, + notes) and EMPTY pitches/officials so
--     the editor shows only the away-editable fields.
--   * club_manager_update_home_fixture — new p_notes param (old 6-arg signature DROPPED to
--     avoid a stale overload). Home branch = as before + notes. Away branch = update only
--     kick-off/location/notes; reject any pitch/ref attempt (away_pitch_ref_read_only).
--
-- Proof: ephemeral-verify (throwaway _e2e_ fixture, auto-rollback, leak 0) MUST show:
--   (1) options(home)  → ok:true, is_home:true, pitches/officials populated;
--   (2) options(away)  → ok:true, is_home:false, pitches=[]/officials=[], notes surfaced;
--   (3) update(home)   → pitch/ref/kickoff/location/notes all persist (unchanged behaviour);
--   (4) update(away)   → kickoff/location/notes persist; playing_area_id/official_id/ref_name
--       on the row are UNCHANGED;
--   (5) update(away) with a pitch/ref arg → away_pitch_ref_read_only (rejected);
--   (6) non-manager / unauth → not_a_manager / not_authenticated.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. club_manager_get_home_fixture_options — away returns ok:true (+ is_home, notes)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_manager_get_home_fixture_options(p_fixture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_fix        record;
  v_pitches    jsonb;
  v_officials  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'profile_not_found'); END IF;

  SELECT cf.id, cf.club_team_id, cf.is_home, cf.playing_area_id, cf.official_id,
         cf.ref_name, cf.kickoff_time, cf.scheduled_date, cf.opponent_name, cf.location, cf.notes,
         cl.club_id, cl.venue_id AS league_venue_id
    INTO v_fix
  FROM public.club_fixtures cf
  JOIN public.club_leagues cl ON cl.id = cf.league_id
  JOIN public.club_team_managers ctm
    ON ctm.team_id = cf.club_team_id AND ctm.member_profile_id = v_profile_id AND ctm.is_active = true
  WHERE cf.id = p_fixture_id;

  IF v_fix.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_manager'); END IF;

  -- AWAY: editable now (kick-off / location / notes only). No pitch/ref list — those belong
  -- to the host ground. is_home:false tells the editor to hide the pitch + referee fields.
  IF NOT v_fix.is_home THEN
    RETURN jsonb_build_object(
      'ok', true,
      'fixture', jsonb_build_object(
        'fixture_id',      v_fix.id,
        'opponent_name',   v_fix.opponent_name,
        'scheduled_date',  v_fix.scheduled_date,
        'kickoff_time',    to_char(v_fix.kickoff_time, 'HH24:MI'),
        'playing_area_id', v_fix.playing_area_id,
        'official_id',     v_fix.official_id,
        'ref_name',        v_fix.ref_name,
        'location',        v_fix.location,
        'notes',           v_fix.notes,
        'is_home',         false),
      'pitches',   '[]'::jsonb,
      'officials', '[]'::jsonb
    );
  END IF;

  WITH allowed AS (
    SELECT v_fix.league_venue_id AS venue_id
    UNION
    SELECT cv.venue_id FROM public.club_venues cv
    JOIN public.venues tv ON tv.id = cv.venue_id
    WHERE cv.club_id = v_fix.club_id AND tv.company_id IS NOT NULL
      AND tv.company_id = (SELECT company_id FROM public.venues WHERE id = v_fix.league_venue_id)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name,
                'venue_id', pa.venue_id, 'venue_name', v.name)
                ORDER BY v.name, pa.sort_order, pa.name)
              FROM public.playing_areas pa JOIN public.venues v ON v.id = pa.venue_id
              WHERE pa.venue_id IN (SELECT venue_id FROM allowed) AND pa.active), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', mo.id, 'name', mo.name,
                'venue_id', mo.venue_id, 'venue_name', v.name)
                ORDER BY v.name, mo.name)
              FROM public.match_officials mo JOIN public.venues v ON v.id = mo.venue_id
              WHERE mo.venue_id IN (SELECT venue_id FROM allowed) AND mo.active), '[]'::jsonb)
  INTO v_pitches, v_officials;

  RETURN jsonb_build_object(
    'ok', true,
    'fixture', jsonb_build_object(
      'fixture_id',      v_fix.id,
      'opponent_name',   v_fix.opponent_name,
      'scheduled_date',  v_fix.scheduled_date,
      'kickoff_time',    to_char(v_fix.kickoff_time, 'HH24:MI'),
      'playing_area_id', v_fix.playing_area_id,
      'official_id',     v_fix.official_id,
      'ref_name',        v_fix.ref_name,
      'location',        v_fix.location,
      'notes',           v_fix.notes,
      'is_home',         true),
    'pitches',   v_pitches,
    'officials', v_officials
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. club_manager_update_home_fixture — + p_notes; away edits kickoff/location/notes
--    (DROP the old 6-arg signature so only the 7-arg version exists — no stale overload)
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time without time zone, text);

CREATE OR REPLACE FUNCTION public.club_manager_update_home_fixture(
  p_fixture_id uuid,
  p_playing_area_id uuid DEFAULT NULL::uuid,
  p_official_id uuid DEFAULT NULL::uuid,
  p_ref_name text DEFAULT NULL::text,
  p_kickoff_time time without time zone DEFAULT NULL::time without time zone,
  p_location text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   record;
  v_fix       record;
  v_pitch_ven text;
  v_off_ven   text;
  v_ref_name  text;
  v_location  text := NULLIF(btrim(p_location), '');
  v_notes     text := NULLIF(btrim(p_notes), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile
    FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT cf.id, cf.club_team_id, cf.is_home, cl.club_id, cl.venue_id AS league_venue_id
    INTO v_fix
  FROM public.club_fixtures cf
  JOIN public.club_leagues cl ON cl.id = cf.league_id
  JOIN public.club_team_managers ctm
    ON ctm.team_id = cf.club_team_id AND ctm.member_profile_id = v_profile.id AND ctm.is_active = true
  WHERE cf.id = p_fixture_id;

  IF v_fix.id IS NULL THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  IF v_fix.is_home THEN
    -- HOME: pitch + referee are the club's to set (validated against the club's operator
    -- venues). Behaviour identical to mig 545 + the new notes field.
    IF p_playing_area_id IS NOT NULL THEN
      SELECT venue_id INTO v_pitch_ven FROM public.playing_areas WHERE id = p_playing_area_id AND active;
      IF v_pitch_ven IS NULL
         OR (v_pitch_ven <> v_fix.league_venue_id
             AND NOT public._venue_in_club_operator(v_fix.league_venue_id, v_fix.club_id, v_pitch_ven)) THEN
        RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF p_official_id IS NOT NULL THEN
      SELECT venue_id INTO v_off_ven FROM public.match_officials WHERE id = p_official_id AND active;
      IF v_off_ven IS NULL
         OR (v_off_ven <> v_fix.league_venue_id
             AND NOT public._venue_in_club_operator(v_fix.league_venue_id, v_fix.club_id, v_off_ven)) THEN
        RAISE EXCEPTION 'ref_not_in_venue' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_ref_name := CASE WHEN p_official_id IS NOT NULL THEN NULL
                       ELSE NULLIF(btrim(p_ref_name), '') END;

    UPDATE public.club_fixtures SET
      playing_area_id = p_playing_area_id,
      official_id     = p_official_id,
      ref_name        = v_ref_name,
      kickoff_time    = p_kickoff_time,
      location        = v_location,
      notes           = v_notes,
      updated_at      = now()
    WHERE id = p_fixture_id;
  ELSE
    -- AWAY: at the opponent's ground — the pitch/referee are NOT the Manager's to set.
    -- Reject any attempt to set them; update only the coordination fields.
    IF p_playing_area_id IS NOT NULL OR p_official_id IS NOT NULL
       OR NULLIF(btrim(p_ref_name), '') IS NOT NULL THEN
      RAISE EXCEPTION 'away_pitch_ref_read_only' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.club_fixtures SET
      kickoff_time = p_kickoff_time,
      location     = v_location,
      notes        = v_notes,
      updated_at   = now()
    WHERE id = p_fixture_id;
  END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_fix.league_venue_id, v_uid, 'player',
          v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
          'club_fixture_manager_updated', 'club_fixture', p_fixture_id::text,
          jsonb_build_object('is_home', v_fix.is_home, 'kickoff_time', p_kickoff_time,
                             'location', v_location, 'notes', v_notes,
                             'playing_area_id', CASE WHEN v_fix.is_home THEN p_playing_area_id ELSE NULL END,
                             'official_id',     CASE WHEN v_fix.is_home THEN p_official_id ELSE NULL END,
                             'ref_name',        CASE WHEN v_fix.is_home THEN v_ref_name ELSE NULL END));

  RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time without time zone, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time without time zone, text, text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
