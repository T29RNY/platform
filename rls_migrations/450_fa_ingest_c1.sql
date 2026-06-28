-- 450 — Epic C / C1: FA Full-Time fixture ingest pipeline (server-side only).
-- Epic: MODULAR_PLATFORM_HANDOFF.md "EPIC C — … C1 SPEC LOCKED (session 223)".
--
-- The DB foundation already exists (mig 394): club_leagues.{fa_source_url,
-- fa_embed_code, fa_last_synced_at}; club_fixtures.{source CHECK('manual','fa_import'),
-- fa_fixture_key} + the partial unique index uq_club_fixtures_fa (league_id,
-- fa_fixture_key) WHERE fa_fixture_key IS NOT NULL. C1 is ONLY the ingest pipeline:
--   1. a service-role RPC that idempotently UPSERTs a batch of parsed FA fixtures,
--      stamps fa_last_synced_at, and audits (Hard Rule #9);
--   2. extends the operator RPC venue_update_club_league with a p_fa_source_url setter.
-- The JS parser + faSyncJob (apps/inorout/api/_fa_parser.js + cron.js) call (1).
-- No client surface, no casual surface — additive, server-side only.

-- ── 1. Service-role ingest RPC: idempotent UPSERT of parsed FA fixtures ───────
-- Called only by the cron faSyncJob (service-role). Each element of p_fixtures is:
--   { fa_fixture_key, club_team_id?, club_team_name?, opponent_name,
--     is_home, scheduled_date?, kickoff_time?, home_score?, away_score?, status }
-- The JS side does the team-mapping (normalise vs club_teams.name) and passes a
-- resolved club_team_id (NULL when neither side is ours). This RPC stays dumb +
-- idempotent: re-syncing the same feed is a clean no-op on the FA-derived columns
-- and NEVER touches a manual pitch/ref/notes assignment.
CREATE OR REPLACE FUNCTION public.fa_ingest_upsert_fixtures(
  p_league_id uuid, p_fixtures jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_league   record;
  v_fx       jsonb;
  v_key      text;
  v_opp      text;
  v_team_id  uuid;
  v_status   text;
  v_upserted integer := 0;
  v_matched  integer := 0;
BEGIN
  SELECT id, club_id, venue_id INTO v_league
    FROM public.club_leagues WHERE id = p_league_id;
  IF v_league.id IS NULL THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_fixtures IS NULL OR jsonb_typeof(p_fixtures) <> 'array' THEN
    RAISE EXCEPTION 'fixtures_must_be_array' USING ERRCODE = 'P0001';
  END IF;

  FOR v_fx IN SELECT * FROM jsonb_array_elements(p_fixtures) LOOP
    v_key := NULLIF(btrim(COALESCE(v_fx->>'fa_fixture_key', '')), '');
    v_opp := NULLIF(btrim(COALESCE(v_fx->>'opponent_name', '')), '');
    -- idempotent key + a free-text opponent are both mandatory; skip junk rows
    CONTINUE WHEN v_key IS NULL OR v_opp IS NULL;

    -- status: parser sends 'completed' or 'scheduled'; clamp anything else
    v_status := COALESCE(v_fx->>'status', 'scheduled');
    IF v_status NOT IN ('scheduled','completed','postponed','void') THEN
      v_status := 'scheduled';
    END IF;

    -- club_team_id must belong to THIS league's club; otherwise treat as unmatched
    v_team_id := NULL;
    IF NULLIF(btrim(COALESCE(v_fx->>'club_team_id', '')), '') IS NOT NULL THEN
      SELECT ct.id INTO v_team_id FROM public.club_teams ct
       WHERE ct.id = (v_fx->>'club_team_id')::uuid
         AND ct.club_id = v_league.club_id;
    END IF;
    IF v_team_id IS NOT NULL THEN v_matched := v_matched + 1; END IF;

    INSERT INTO public.club_fixtures (
      league_id, club_team_id, club_team_name, opponent_name, is_home,
      scheduled_date, kickoff_time, home_score, away_score, status,
      source, fa_fixture_key)
    VALUES (
      p_league_id, v_team_id,
      NULLIF(btrim(COALESCE(v_fx->>'club_team_name', '')), ''),
      v_opp,
      COALESCE((v_fx->>'is_home')::boolean, true),
      NULLIF(v_fx->>'scheduled_date', '')::date,
      NULLIF(v_fx->>'kickoff_time', '')::time,
      NULLIF(v_fx->>'home_score', '')::integer,
      NULLIF(v_fx->>'away_score', '')::integer,
      v_status, 'fa_import', v_key)
    ON CONFLICT (league_id, fa_fixture_key) WHERE fa_fixture_key IS NOT NULL
    DO UPDATE SET
      club_team_id   = EXCLUDED.club_team_id,
      club_team_name = EXCLUDED.club_team_name,
      opponent_name  = EXCLUDED.opponent_name,
      is_home        = EXCLUDED.is_home,
      scheduled_date = EXCLUDED.scheduled_date,
      kickoff_time   = EXCLUDED.kickoff_time,
      home_score     = EXCLUDED.home_score,
      away_score     = EXCLUDED.away_score,
      status         = EXCLUDED.status,
      source         = 'fa_import',
      updated_at     = now();
      -- playing_area_id / official_id / ref_name / notes deliberately NOT
      -- overwritten — a manual pitch/ref assignment survives every re-sync.

    v_upserted := v_upserted + 1;
  END LOOP;

  UPDATE public.club_leagues SET fa_last_synced_at = now() WHERE id = p_league_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action,
     entity_type, entity_id, metadata)
  VALUES (v_league.venue_id, NULL, 'system', 'fa_sync',
          'fa_fixtures_ingested', 'club_league', p_league_id::text,
          jsonb_build_object('upserted', v_upserted, 'matched', v_matched));

  RETURN jsonb_build_object('ok', true, 'league_id', p_league_id,
                            'upserted', v_upserted, 'matched', v_matched);
END;
$function$;

-- Supabase ALTER DEFAULT PRIVILEGES auto-grants anon+authenticated on new
-- functions → REVOKE them explicitly so this stays service-role-ONLY.
REVOKE ALL ON FUNCTION public.fa_ingest_upsert_fixtures(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fa_ingest_upsert_fixtures(uuid, jsonb) TO service_role;

-- ── 2. Extend venue_update_club_league with the FA source-URL setter ──────────
-- Adding a param changes the signature → DROP the old 6-arg overload first
-- (CREATE OR REPLACE would leave it as a stale overload). Same empty-clears /
-- NULL-leaves idiom as fa_embed_code.
DROP FUNCTION IF EXISTS public.venue_update_club_league(text, uuid, text, text, boolean, text);
CREATE OR REPLACE FUNCTION public.venue_update_club_league(
  p_venue_token text, p_league_id uuid, p_name text DEFAULT NULL,
  p_season_label text DEFAULT NULL, p_archived boolean DEFAULT NULL,
  p_fa_embed_code text DEFAULT NULL, p_fa_source_url text DEFAULT NULL)
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
    name          = COALESCE(NULLIF(btrim(p_name), ''), name),
    season_label  = COALESCE(NULLIF(btrim(p_season_label), ''), season_label),
    archived_at   = CASE WHEN p_archived IS NULL THEN archived_at
                         WHEN p_archived THEN COALESCE(archived_at, now())
                         ELSE NULL END,
    -- empty string clears the stored value; NULL leaves it unchanged
    fa_embed_code = CASE WHEN p_fa_embed_code IS NULL THEN fa_embed_code
                         WHEN btrim(p_fa_embed_code) = '' THEN NULL
                         ELSE p_fa_embed_code END,
    fa_source_url = CASE WHEN p_fa_source_url IS NULL THEN fa_source_url
                         WHEN btrim(p_fa_source_url) = '' THEN NULL
                         ELSE btrim(p_fa_source_url) END
  WHERE id = p_league_id AND venue_id = v_venue;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_league_updated', 'club_league', p_league_id::text,
          jsonb_build_object('archived', p_archived,
                             'fa_snippet_set', p_fa_embed_code IS NOT NULL,
                             'fa_source_set', p_fa_source_url IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'league_id', p_league_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean, text, text) TO anon, authenticated;
