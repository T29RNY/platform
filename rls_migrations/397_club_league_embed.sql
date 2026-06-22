-- 397 — Embed code (Pilot demo sprint, item #9). Put a club's fixtures/results on
-- their own website: (a) OUR embeddable widget via a public per-league embed_code +
-- a chrome-free /embed/league/<code> view, and (b) store the club's official FA
-- Full-Time "Code Snippet" alongside the league (fa_embed_code already exists from
-- mig 394) so the operator keeps it on file and pastes it on their own site for the
-- official division table. Additive only.

-- ── 1. Per-league public embed code ──────────────────────────────────────────
ALTER TABLE public.club_leagues
  ADD COLUMN IF NOT EXISTS embed_code text;
-- Backfill existing rows + default for new ones (short, public — read-only widget key).
UPDATE public.club_leagues
   SET embed_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
 WHERE embed_code IS NULL;
ALTER TABLE public.club_leagues
  ALTER COLUMN embed_code SET DEFAULT lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
CREATE UNIQUE INDEX IF NOT EXISTS uq_club_leagues_embed ON public.club_leagues(embed_code);

-- ── 2. Extend venue_update_club_league with the FA snippet param ──────────────
-- Adding a param changes the signature → DROP the old 5-arg overload first.
DROP FUNCTION IF EXISTS public.venue_update_club_league(text, uuid, text, text, boolean);
CREATE OR REPLACE FUNCTION public.venue_update_club_league(
  p_venue_token text, p_league_id uuid, p_name text DEFAULT NULL,
  p_season_label text DEFAULT NULL, p_archived boolean DEFAULT NULL,
  p_fa_embed_code text DEFAULT NULL)
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
    -- empty string clears the stored FA snippet; NULL leaves it unchanged
    fa_embed_code = CASE WHEN p_fa_embed_code IS NULL THEN fa_embed_code
                         WHEN btrim(p_fa_embed_code) = '' THEN NULL
                         ELSE p_fa_embed_code END
  WHERE id = p_league_id AND venue_id = v_venue;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_league_updated', 'club_league', p_league_id::text,
          jsonb_build_object('archived', p_archived, 'fa_snippet_set', p_fa_embed_code IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'league_id', p_league_id);
END;
$function$;

-- ── 3. venue_list_club_leagues: surface embed_code + fa_embed_code ────────────
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
             'embed_code', cl.embed_code, 'fa_embed_code', cl.fa_embed_code,
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

-- ── 4. Public embed read: a league's fixtures + results ──────────────────────
CREATE OR REPLACE FUNCTION public.get_club_league_public(p_embed_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_league record;
  v_fixtures jsonb;
BEGIN
  SELECT cl.id, cl.name, cl.season_label, c.name AS club_name
    INTO v_league
  FROM public.club_leagues cl
  JOIN public.clubs c ON c.id = cl.club_id
  WHERE cl.embed_code = p_embed_code AND cl.archived_at IS NULL;

  IF v_league.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY sd NULLS LAST, kt), '[]'::jsonb) INTO v_fixtures FROM (
    SELECT f.scheduled_date AS sd, f.kickoff_time AS kt,
           jsonb_build_object(
             'our_team', COALESCE(f.club_team_name, ct.name), 'opponent', f.opponent_name,
             'is_home', f.is_home, 'scheduled_date', f.scheduled_date,
             'kickoff_time', to_char(f.kickoff_time, 'HH24:MI'),
             'pitch_name', pa.name, 'home_score', f.home_score, 'away_score', f.away_score,
             'status', f.status
           ) AS row
    FROM public.club_fixtures f
    LEFT JOIN public.club_teams    ct ON ct.id = f.club_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    WHERE f.league_id = v_league.id AND f.status <> 'void'
  ) s;

  RETURN jsonb_build_object(
    'ok', true, 'club_name', v_league.club_name, 'league_name', v_league.name,
    'season_label', v_league.season_label, 'fixtures', v_fixtures);
END;
$function$;

-- ── 5. Grants ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean, text) FROM public;
REVOKE ALL ON FUNCTION public.get_club_league_public(text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_league_public(text) TO anon, authenticated;
