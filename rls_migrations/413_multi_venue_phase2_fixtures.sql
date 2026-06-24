-- Migration 413 — Multi-venue (pilot #7) Phase 2: cross-venue club FIXTURES.
--
-- Same-operator only (reuses the live Phase-1 guard _venue_in_club_operator from
-- mig 412). Phase 1 anchored SESSIONS to the right site; this lets a club play a
-- "home" league fixture at EITHER of its same-operator venues — not just the
-- caller's own venue — so the public matchday link shows the CORRECT ground for an
-- away-site home game.
--
-- NO schema/column change, NO new table, NO new guard. Three function bodies only:
--   1. venue_upsert_club_fixture — relax the pitch gate from "pitch ∈ caller venue"
--      to "pitch ∈ caller venue OR pitch ∈ one of the club's same-operator venues".
--      The "= caller venue" short-circuit keeps single-venue clubs (incl. NULL
--      company_id) byte-identical — the guard (which requires non-null company_id)
--      is consulted ONLY when the chosen pitch is at a DIFFERENT venue. Same error
--      code 'pitch_not_in_venue' (the venue UI already handles it). The official
--      (ref) gate stays caller-venue-scoped — relaxing officials is out of Phase-2
--      scope (away-site fixtures use a free-text ref or none).
--   2. venue_list_club_fixtures (venue console reader) — add venue_id / venue_name /
--      venue_address, sourced from COALESCE(pitch.venue, league.venue), so the
--      operator sees WHICH site each fixture is at (cross-site visibility).
--   3. get_club_fixture_matchday (public anon read) — derive the ground from the
--      PITCH'S venue (COALESCE(pa.venue_id, cl.venue_id)) instead of always the
--      league's home venue. Return keys unchanged → no consumer change.
-- Signatures unchanged on all three → CREATE OR REPLACE preserves grants (no DROP,
-- no overload risk).

-- ─── 1. venue_upsert_club_fixture — same-operator pitch validation ────────────
CREATE OR REPLACE FUNCTION public.venue_upsert_club_fixture(
  p_venue_token text,
  p_fixture_id uuid DEFAULT NULL,
  p_league_id uuid DEFAULT NULL,
  p_club_team_id uuid DEFAULT NULL,
  p_club_team_name text DEFAULT NULL,
  p_opponent_name text DEFAULT NULL,
  p_is_home boolean DEFAULT NULL,
  p_scheduled_date date DEFAULT NULL,
  p_kickoff_time time DEFAULT NULL,
  p_playing_area_id uuid DEFAULT NULL,
  p_official_id uuid DEFAULT NULL,
  p_ref_name text DEFAULT NULL,
  p_home_score integer DEFAULT NULL,
  p_away_score integer DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller       record;
  v_venue        text;
  v_league       record;
  v_id           uuid;
  v_code         text;
  v_pitch_venue  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('scheduled','completed','postponed','void') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;
  -- ref must belong to this (the caller's) venue when supplied — unchanged.
  IF p_official_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.match_officials WHERE id = p_official_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'ref_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  IF p_fixture_id IS NULL THEN
    ----- CREATE -----
    IF p_league_id IS NULL THEN RAISE EXCEPTION 'league_required' USING ERRCODE = 'P0001'; END IF;
    IF NULLIF(btrim(p_opponent_name), '') IS NULL THEN
      RAISE EXCEPTION 'opponent_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT cl.id, cl.club_id INTO v_league
      FROM public.club_leagues cl WHERE cl.id = p_league_id AND cl.venue_id = v_venue;
    IF v_league.id IS NULL THEN RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001'; END IF;
    IF p_club_team_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.club_teams WHERE id = p_club_team_id AND club_id = v_league.club_id) THEN
      RAISE EXCEPTION 'team_not_in_club' USING ERRCODE = 'P0001';
    END IF;
    -- Multi-venue pitch gate: caller's own venue OR a same-operator club venue.
    IF p_playing_area_id IS NOT NULL THEN
      SELECT venue_id INTO v_pitch_venue FROM public.playing_areas WHERE id = p_playing_area_id;
      IF v_pitch_venue IS NULL
         OR (v_pitch_venue <> v_venue
             AND NOT public._venue_in_club_operator(v_venue, v_league.club_id, v_pitch_venue)) THEN
        RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.club_fixtures (
      league_id, club_team_id, club_team_name, opponent_name, is_home,
      scheduled_date, kickoff_time, playing_area_id, official_id, ref_name,
      home_score, away_score, status, notes)
    VALUES (
      p_league_id, p_club_team_id, NULLIF(btrim(p_club_team_name), ''),
      btrim(p_opponent_name), COALESCE(p_is_home, true),
      p_scheduled_date, p_kickoff_time, p_playing_area_id, p_official_id, NULLIF(btrim(p_ref_name), ''),
      p_home_score, p_away_score, COALESCE(p_status, 'scheduled'), NULLIF(btrim(p_notes), ''))
    RETURNING id, share_code INTO v_id, v_code;

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'club_fixture_created', 'club_fixture', v_id::text,
            jsonb_build_object('league_id', p_league_id, 'opponent', btrim(p_opponent_name),
                               'pitch_venue', v_pitch_venue));
    RETURN jsonb_build_object('ok', true, 'fixture_id', v_id, 'share_code', v_code, 'created', true);
  ELSE
    ----- UPDATE ----- (scope by joining the league to the caller's venue)
    SELECT f.id, f.share_code, cl.club_id INTO v_league
      FROM public.club_fixtures f
      JOIN public.club_leagues cl ON cl.id = f.league_id
      WHERE f.id = p_fixture_id AND cl.venue_id = v_venue;
    IF v_league.id IS NULL THEN RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001'; END IF;
    IF p_club_team_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.club_teams WHERE id = p_club_team_id AND club_id = v_league.club_id) THEN
      RAISE EXCEPTION 'team_not_in_club' USING ERRCODE = 'P0001';
    END IF;
    -- Multi-venue pitch gate: caller's own venue OR a same-operator club venue.
    IF p_playing_area_id IS NOT NULL THEN
      SELECT venue_id INTO v_pitch_venue FROM public.playing_areas WHERE id = p_playing_area_id;
      IF v_pitch_venue IS NULL
         OR (v_pitch_venue <> v_venue
             AND NOT public._venue_in_club_operator(v_venue, v_league.club_id, v_pitch_venue)) THEN
        RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    UPDATE public.club_fixtures SET
      club_team_id    = COALESCE(p_club_team_id, club_team_id),
      club_team_name  = COALESCE(NULLIF(btrim(p_club_team_name), ''), club_team_name),
      opponent_name   = COALESCE(NULLIF(btrim(p_opponent_name), ''), opponent_name),
      is_home         = COALESCE(p_is_home, is_home),
      scheduled_date  = COALESCE(p_scheduled_date, scheduled_date),
      kickoff_time    = COALESCE(p_kickoff_time, kickoff_time),
      playing_area_id = COALESCE(p_playing_area_id, playing_area_id),
      official_id     = COALESCE(p_official_id, official_id),
      ref_name        = COALESCE(NULLIF(btrim(p_ref_name), ''), ref_name),
      home_score      = COALESCE(p_home_score, home_score),
      away_score      = COALESCE(p_away_score, away_score),
      status          = COALESCE(p_status, status),
      notes           = COALESCE(NULLIF(btrim(p_notes), ''), notes),
      updated_at      = now()
    WHERE id = p_fixture_id;

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'club_fixture_updated', 'club_fixture', p_fixture_id::text,
            jsonb_build_object('status', p_status, 'pitch_venue', v_pitch_venue));
    RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id, 'share_code', v_league.share_code, 'created', false);
  END IF;
END;
$function$;

-- ─── 2. venue_list_club_fixtures — + venue_id / venue_name / venue_address ─────
CREATE OR REPLACE FUNCTION public.venue_list_club_fixtures(
  p_venue_token text, p_league_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
  v_out    jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT EXISTS (SELECT 1 FROM public.club_leagues WHERE id = p_league_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY sd, kt), '[]'::jsonb) INTO v_out FROM (
    SELECT f.scheduled_date AS sd, f.kickoff_time AS kt,
           jsonb_build_object(
             'fixture_id', f.id, 'league_id', f.league_id,
             'club_team_id', f.club_team_id,
             'club_team_name', COALESCE(f.club_team_name, ct.name),
             'opponent_name', f.opponent_name, 'is_home', f.is_home,
             'scheduled_date', f.scheduled_date, 'kickoff_time', to_char(f.kickoff_time, 'HH24:MI'),
             'playing_area_id', f.playing_area_id, 'pitch_name', pa.name,
             -- Multi-venue: the fixture's site = the pitch's venue, else the league's home venue.
             'venue_id', v.id, 'venue_name', v.name,
             'venue_address', NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
             'official_id', f.official_id, 'referee_name', COALESCE(mo.name, f.ref_name),
             'home_score', f.home_score, 'away_score', f.away_score,
             'status', f.status, 'share_code', f.share_code,
             'source', f.source, 'notes', f.notes
           ) AS row
    FROM public.club_fixtures f
    JOIN public.club_leagues   cl ON cl.id = f.league_id
    LEFT JOIN public.club_teams    ct ON ct.id = f.club_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.venues        v  ON v.id  = COALESCE(pa.venue_id, cl.venue_id)
    LEFT JOIN public.match_officials mo ON mo.id = f.official_id
    WHERE f.league_id = p_league_id
  ) s;
  RETURN jsonb_build_object('ok', true, 'fixtures', v_out);
END;
$function$;

-- ─── 3. get_club_fixture_matchday — ground = the PITCH'S venue (away-site fix) ─
CREATE OR REPLACE FUNCTION public.get_club_fixture_matchday(p_share_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT
    f.id, f.opponent_name, f.is_home, f.scheduled_date,
    to_char(f.kickoff_time, 'HH24:MI') AS kickoff_time,
    f.home_score, f.away_score, f.status, f.notes,
    COALESCE(f.club_team_name, ct.name) AS our_team,
    pa.name  AS pitch_name,
    COALESCE(mo.name, f.ref_name) AS referee_name,
    cl.name  AS league_name,
    c.name   AS club_name,
    v.name AS venue_name, v.address AS venue_address, v.city AS venue_city,
    v.postcode AS venue_postcode, v.lat AS venue_lat, v.lng AS venue_lng,
    v.contact_phone AS venue_contact_phone, v.contact_email AS venue_contact_email,
    COALESCE(v.matchday_info, '{}'::jsonb) AS info
  INTO r
  FROM public.club_fixtures f
  JOIN public.club_leagues  cl ON cl.id = f.league_id
  JOIN public.clubs         c  ON c.id  = cl.club_id
  LEFT JOIN public.club_teams      ct ON ct.id = f.club_team_id
  LEFT JOIN public.playing_areas   pa ON pa.id = f.playing_area_id
  -- Multi-venue: show the ground the game is ACTUALLY at (the pitch's venue),
  -- falling back to the league's home venue when no pitch is assigned.
  JOIN public.venues        v  ON v.id  = COALESCE(pa.venue_id, cl.venue_id)
  LEFT JOIN public.match_officials mo ON mo.id = f.official_id
  WHERE f.share_code = p_share_code;

  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'our_team', r.our_team, 'opponent', r.opponent_name, 'is_home', r.is_home,
    'scheduled_date', r.scheduled_date, 'kickoff_time', r.kickoff_time,
    'pitch_name', r.pitch_name, 'referee_name', r.referee_name,
    'home_score', r.home_score, 'away_score', r.away_score, 'status', r.status,
    'notes', r.notes, 'league_name', r.league_name, 'club_name', r.club_name,
    'venue_name', r.venue_name, 'venue_address', r.venue_address, 'venue_city', r.venue_city,
    'venue_postcode', r.venue_postcode, 'venue_lat', r.venue_lat, 'venue_lng', r.venue_lng,
    'venue_contact_phone', r.venue_contact_phone, 'venue_contact_email', r.venue_contact_email,
    'info', r.info
  );
END;
$function$;

-- Grants unchanged (CREATE OR REPLACE preserves them); re-assert defensively.
REVOKE ALL ON FUNCTION public.venue_upsert_club_fixture(text, uuid, uuid, uuid, text, text, boolean, date, time, uuid, uuid, text, integer, integer, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_upsert_club_fixture(text, uuid, uuid, uuid, text, text, boolean, date, time, uuid, uuid, text, integer, integer, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_list_club_fixtures(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_club_fixtures(text, uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_club_fixture_matchday(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_club_fixture_matchday(text) TO anon, authenticated;

-- Schema cache refresh (PostgREST serves stale signatures after function changes).
SELECT pg_notify('pgrst', 'reload schema');
