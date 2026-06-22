-- 394 — Club League + home/away fixtures (Pilot demo sprint, item #8 spine + FA-import target)
-- Epic: PILOT_DEMO_SPRINT_HANDOFF.md. Additive only — two brand-new RPC-only tables,
-- one additive jsonb column on venues. Touches NOTHING on the casual football side
-- (`fixtures`/`teams`/`competitions` untouched).
--
-- WHY a new pair of tables rather than reuse `fixtures`: the existing league `fixtures`
-- table FK-binds BOTH sides to a registered `teams` row (ON DELETE RESTRICT) and has no
-- free-text opponent. A grassroots club's real games are vs EXTERNAL clubs (and the FA
-- import only yields opponent NAMES), so we need free-text opponents + a home/away flag.
-- `club_leagues` is the operator-named "League" container; `club_fixtures` holds the games.
-- Reuses everything that already works: playing_areas (pitch), match_officials (ref),
-- venues (address/lat/lng/contact), the public share-code pattern, the audit spine.
--
-- New venue-token RPCs follow the mig-389 club_* pattern exactly:
--   resolve_venue_caller(p_venue_token) -> _venue_has_cap(..., 'manage_memberships')
--   on writes, + audit_events insert (Hard Rule #9). anon+authenticated grant (the venue
--   token is the auth signal) BUT explicit REVOKE … FROM anon is NOT needed here because
--   we GRANT to anon deliberately (consistent with the club_* family). NOTE the mig-175
--   gotcha is the inverse case (authenticated-only fns) — these are venue-token fns.
--
-- FA-import columns (fa_source_url / fa_embed_code / fa_last_synced_at on club_leagues;
-- source / fa_fixture_key on club_fixtures) are added DORMANT now so Phase C (mig 396)
-- is purely behavioural — no schema churn on the import build.

-- ── 1. Tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_leagues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           text NOT NULL REFERENCES public.clubs(id)  ON DELETE CASCADE,
  venue_id          text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name              text NOT NULL,
  season_label      text,
  -- FA import (Phase C) — dormant until then
  fa_source_url     text,
  fa_embed_code     text,
  fa_last_synced_at timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_club_leagues_club  ON public.club_leagues(club_id);
CREATE INDEX IF NOT EXISTS idx_club_leagues_venue ON public.club_leagues(venue_id);

CREATE TABLE IF NOT EXISTS public.club_fixtures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid NOT NULL REFERENCES public.club_leagues(id) ON DELETE CASCADE,
  club_team_id    uuid REFERENCES public.club_teams(id) ON DELETE SET NULL,  -- our team (optional)
  club_team_name  text,                       -- label/fallback for our team
  opponent_name   text NOT NULL,              -- external opponent, free text
  is_home         boolean NOT NULL DEFAULT true,
  scheduled_date  date,
  kickoff_time    time,
  playing_area_id uuid REFERENCES public.playing_areas(id)  ON DELETE SET NULL,
  official_id     uuid REFERENCES public.match_officials(id) ON DELETE SET NULL,
  ref_name        text,                       -- free-text ref (alt to a match_official)
  home_score      integer,
  away_score      integer,
  status          text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','completed','postponed','void')),
  share_code      text UNIQUE NOT NULL
                    DEFAULT lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual','fa_import')),
  fa_fixture_key  text,                       -- stable-ish key for FA diffing (Phase C)
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_club_fixtures_league ON public.club_fixtures(league_id);
CREATE INDEX IF NOT EXISTS idx_club_fixtures_date   ON public.club_fixtures(scheduled_date);
-- de-dupe key for FA import upserts (NULL fa_fixture_key rows = manual, never collide)
CREATE UNIQUE INDEX IF NOT EXISTS uq_club_fixtures_fa
  ON public.club_fixtures(league_id, fa_fixture_key) WHERE fa_fixture_key IS NOT NULL;

ALTER TABLE public.club_leagues  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_fixtures ENABLE ROW LEVEL SECURITY;
-- RPC-only: no policies (all access via SECURITY DEFINER functions below).

-- Per-venue matchday ground rules (reused across every home fixture's public link).
-- jsonb keyed to mirror the tournament Info view: parking / rules / directions / contact.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS matchday_info jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. League CRUD (venue-token) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_club_league(
  p_venue_token text, p_club_id text, p_name text, p_season_label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller  record;
  v_venue   text;
  v_id      uuid;
  v_name    text := NULLIF(btrim(p_name), '');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_leagues (club_id, venue_id, name, season_label)
  VALUES (p_club_id, v_venue, v_name, NULLIF(btrim(p_season_label), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_league_created', 'club_league', v_id::text,
          jsonb_build_object('club_id', p_club_id, 'name', v_name));
  RETURN jsonb_build_object('ok', true, 'league_id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_update_club_league(
  p_venue_token text, p_league_id uuid, p_name text DEFAULT NULL,
  p_season_label text DEFAULT NULL, p_archived boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_leagues WHERE id = p_league_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.club_leagues SET
    name         = COALESCE(NULLIF(btrim(p_name), ''), name),
    season_label = COALESCE(NULLIF(btrim(p_season_label), ''), season_label),
    archived_at  = CASE WHEN p_archived IS NULL THEN archived_at
                        WHEN p_archived THEN COALESCE(archived_at, now())
                        ELSE NULL END
  WHERE id = p_league_id AND venue_id = v_venue;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_league_updated', 'club_league', p_league_id::text,
          jsonb_build_object('archived', p_archived));
  RETURN jsonb_build_object('ok', true, 'league_id', p_league_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_list_club_leagues(
  p_venue_token text, p_club_id text DEFAULT NULL)
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

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object(
             'league_id', cl.id, 'club_id', cl.club_id, 'name', cl.name,
             'season_label', cl.season_label, 'archived', cl.archived_at IS NOT NULL,
             'fa_source_url', cl.fa_source_url, 'fa_last_synced_at', cl.fa_last_synced_at,
             'fixture_count', (SELECT count(*) FROM public.club_fixtures f WHERE f.league_id = cl.id)
           ) AS row
    FROM public.club_leagues cl
    WHERE cl.venue_id = v_venue
      AND (p_club_id IS NULL OR cl.club_id = p_club_id)
    ORDER BY cl.archived_at NULLS FIRST, cl.created_at DESC
  ) s;
  RETURN jsonb_build_object('ok', true, 'leagues', v_out);
END;
$function$;

-- ── 3. Fixture upsert + delete + list (venue-token) ──────────────────────────
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
  v_caller record;
  v_venue  text;
  v_league record;
  v_id     uuid;
  v_code   text;
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
  -- pitch + ref must belong to this venue when supplied
  IF p_playing_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
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
            jsonb_build_object('league_id', p_league_id, 'opponent', btrim(p_opponent_name)));
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
            jsonb_build_object('status', p_status));
    RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id, 'share_code', v_league.share_code, 'created', false);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_delete_club_fixture(
  p_venue_token text, p_fixture_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_fixtures f
    JOIN public.club_leagues cl ON cl.id = f.league_id
    WHERE f.id = p_fixture_id AND cl.venue_id = v_venue) THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.club_fixtures WHERE id = p_fixture_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_fixture_deleted', 'club_fixture', p_fixture_id::text, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$function$;

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
             'official_id', f.official_id, 'referee_name', COALESCE(mo.name, f.ref_name),
             'home_score', f.home_score, 'away_score', f.away_score,
             'status', f.status, 'share_code', f.share_code,
             'source', f.source, 'notes', f.notes
           ) AS row
    FROM public.club_fixtures f
    LEFT JOIN public.club_teams    ct ON ct.id = f.club_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.match_officials mo ON mo.id = f.official_id
    WHERE f.league_id = p_league_id
  ) s;
  RETURN jsonb_build_object('ok', true, 'fixtures', v_out);
END;
$function$;

-- ── 4. Per-venue matchday ground rules ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_matchday_info(
  p_venue_token text, p_info jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venues
     SET matchday_info = COALESCE(p_info, '{}'::jsonb)
   WHERE id = v_venue;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_matchday_info_set', 'venue', v_venue, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_get_matchday_info(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_info   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(matchday_info, '{}'::jsonb) INTO v_info FROM public.venues WHERE id = v_caller.venue_id;
  RETURN jsonb_build_object('ok', true, 'info', COALESCE(v_info, '{}'::jsonb));
END;
$function$;

-- ── 5. Grants ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.venue_get_matchday_info(text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_get_matchday_info(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_create_club_league(text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.venue_list_club_leagues(text, text) FROM public;
REVOKE ALL ON FUNCTION public.venue_upsert_club_fixture(text, uuid, uuid, uuid, text, text, boolean, date, time, uuid, uuid, text, integer, integer, text, text) FROM public;
REVOKE ALL ON FUNCTION public.venue_delete_club_fixture(text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.venue_list_club_fixtures(text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.venue_set_matchday_info(text, jsonb) FROM public;

GRANT EXECUTE ON FUNCTION public.venue_create_club_league(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_list_club_leagues(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_upsert_club_fixture(text, uuid, uuid, uuid, text, text, boolean, date, time, uuid, uuid, text, integer, integer, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_delete_club_fixture(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_list_club_fixtures(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_set_matchday_info(text, jsonb) TO anon, authenticated;
