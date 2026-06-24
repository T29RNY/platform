-- Migration 421 — Calendar & Mobile Phase 3b: HOME-team manager edits Club League fixture logistics.
--
-- Phase 3a (mig 420) gave the manager a READ-ONLY Club Leagues fixture in the Agenda.
-- This adds in-place edit for HOME fixtures only: a team manager may change the pitch
-- (playing_area_id), the referee (a named official_id OR free-text ref_name) and the
-- kickoff time. EVERYTHING ELSE stays operator-owned and read-only — opponent, date,
-- scores, status, league, team, is_home are untouched by this RPC. AWAY fixtures are
-- fully read-only (the away club's operator owns them).
--
-- Ownership = auth.uid() → member_profiles → club_team_managers (is_active) on the
-- fixture's club_team, AND club_fixtures.is_home = true. No venue token: the caller is
-- an authenticated app user, not an operator. Mirrors club_manager_resolve_bump (mig 417)
-- for the manager-resolution + audit shape (actor_type 'player', ident = full name).
--
-- Pitch/ref scope = the league's home venue PLUS any same-operator club venue (reuses
-- the live _venue_in_club_operator seam from mig 412, caller_venue = the league venue).
-- Clash protection is NOT re-implemented: the existing tg_sync_club_fixture_occupancy
-- trigger (mig 414) fires AFTER UPDATE OF playing_area_id/kickoff_time and raises
-- 'slot_unavailable' via the pitch_occupancy EXCLUDE constraint — a manager cannot
-- double-book a pitch. audit_events row per Hard Rule #9.
--
-- Two functions:
--   1. club_manager_get_home_fixture_options(uuid) — STABLE reader feeding the edit
--      form's pitch + official pickers (active rows in the allowed venues) plus the
--      fixture's current values. Manager + is_home gated; {ok:false,reason} otherwise.
--   2. club_manager_update_home_fixture(uuid, uuid, uuid, text, time) — the guarded write.
--
-- Consumers (Hard Rule #14): apps/inorout SessionsScreen.jsx FixtureDetail edit form (Phase 3b).

-- ─── 1. OPTIONS READER ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_manager_get_home_fixture_options(p_fixture_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
         cf.ref_name, cf.kickoff_time, cf.scheduled_date, cf.opponent_name,
         cl.club_id, cl.venue_id AS league_venue_id
    INTO v_fix
  FROM public.club_fixtures cf
  JOIN public.club_leagues cl ON cl.id = cf.league_id
  JOIN public.club_team_managers ctm
    ON ctm.team_id = cf.club_team_id AND ctm.member_profile_id = v_profile_id AND ctm.is_active = true
  WHERE cf.id = p_fixture_id;

  IF v_fix.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_manager'); END IF;
  IF NOT v_fix.is_home THEN RETURN jsonb_build_object('ok', false, 'reason', 'away_read_only'); END IF;

  -- allowed venues: the league venue + any same-operator club venue
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
      'ref_name',        v_fix.ref_name),
    'pitches',   v_pitches,
    'officials', v_officials
  );
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_get_home_fixture_options(uuid) FROM public;
REVOKE ALL    ON FUNCTION public.club_manager_get_home_fixture_options(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_manager_get_home_fixture_options(uuid) TO authenticated;

-- ─── 2. GUARDED WRITE ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_manager_update_home_fixture(
  p_fixture_id      uuid,
  p_playing_area_id uuid DEFAULT NULL,
  p_official_id     uuid DEFAULT NULL,
  p_ref_name        text DEFAULT NULL,
  p_kickoff_time    time DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   record;
  v_fix       record;
  v_pitch_ven text;
  v_off_ven   text;
  v_ref_name  text;
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
  IF NOT v_fix.is_home THEN RAISE EXCEPTION 'away_read_only' USING ERRCODE = 'P0001'; END IF;

  -- pitch must be active and in the league venue or a same-operator club venue
  IF p_playing_area_id IS NOT NULL THEN
    SELECT venue_id INTO v_pitch_ven FROM public.playing_areas WHERE id = p_playing_area_id AND active;
    IF v_pitch_ven IS NULL
       OR (v_pitch_ven <> v_fix.league_venue_id
           AND NOT public._venue_in_club_operator(v_fix.league_venue_id, v_fix.club_id, v_pitch_ven)) THEN
      RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- official must be active and in the league venue or a same-operator club venue
  IF p_official_id IS NOT NULL THEN
    SELECT venue_id INTO v_off_ven FROM public.match_officials WHERE id = p_official_id AND active;
    IF v_off_ven IS NULL
       OR (v_off_ven <> v_fix.league_venue_id
           AND NOT public._venue_in_club_operator(v_fix.league_venue_id, v_fix.club_id, v_off_ven)) THEN
      RAISE EXCEPTION 'ref_not_in_venue' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- referee display: a chosen named official supersedes free-text; clearing both is allowed.
  v_ref_name := CASE WHEN p_official_id IS NOT NULL THEN NULL
                     ELSE NULLIF(btrim(p_ref_name), '') END;

  -- Direct SETs (the form submits full edited state) so the manager can CLEAR pitch/ref.
  -- tg_sync_club_fixture_occupancy (mig 414) fires on playing_area_id/kickoff_time and
  -- raises 'slot_unavailable' on a clash — reuse, no manual clash code here.
  UPDATE public.club_fixtures SET
    playing_area_id = p_playing_area_id,
    official_id     = p_official_id,
    ref_name        = v_ref_name,
    kickoff_time    = p_kickoff_time,
    updated_at      = now()
  WHERE id = p_fixture_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_fix.league_venue_id, v_uid, 'player',
          v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''),
          'club_fixture_manager_updated', 'club_fixture', p_fixture_id::text,
          jsonb_build_object('playing_area_id', p_playing_area_id, 'official_id', p_official_id,
                             'ref_name', v_ref_name, 'kickoff_time', p_kickoff_time));

  RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time) FROM public;
REVOKE ALL    ON FUNCTION public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_manager_update_home_fixture(uuid, uuid, uuid, text, time) TO authenticated;

-- Schema cache refresh (PostgREST serves stale signatures after function changes).
SELECT pg_notify('pgrst', 'reload schema');
