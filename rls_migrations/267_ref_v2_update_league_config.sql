-- Migration 267 — Ref V2: update_league_config — the match-format config WRITE path.
-- Cycle "RefSix-killer" / apps/ref/REF_V2_BUILD_PLAN.md, §5 (config write).
--
-- league_config has been read-only / SQL-seeded since Phase 0 (mig 050) with no write RPC.
-- This adds one, callable by BOTH venue operators AND super admins via the existing
-- resolve_venue_caller(p_token), which returns a venue_id for a venue admin/staff token and a
-- 'platform_admin' row (venue_id NULL) for a super admin. A venue caller may only edit a league
-- that belongs to their venue; a platform admin may edit any league.
--
-- Sets the match-format subset (num_periods / period_length_mins / period_names /
-- match_duration_mins / has_sin_bin / sin_bin_mins). Only keys present in p_config change
-- (COALESCE against the existing row). No UNIQUE on league_config.league_id, so this does an
-- explicit UPDATE-then-INSERT (one row per league; the platform default keeps league_id NULL).
-- Resolves into get_fixture_state_by_ref_token's `match_format` (league tier).

CREATE OR REPLACE FUNCTION public.update_league_config(
  p_token     text,
  p_league_id text,
  p_config    jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_venue text;
  v_actor_type   text;
  v_league_venue text;
  v_names        text[];
BEGIN
  IF p_league_id IS NULL THEN RAISE EXCEPTION 'missing_league_id' USING ERRCODE='P0001'; END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN RAISE EXCEPTION 'invalid_config' USING ERRCODE='P0001'; END IF;

  -- resolve caller (venue admin/staff token OR platform admin)
  SELECT venue_id, actor_type INTO v_caller_venue, v_actor_type
  FROM public.resolve_venue_caller(p_token) LIMIT 1;
  IF v_actor_type IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;

  SELECT venue_id INTO v_league_venue FROM public.leagues WHERE id = p_league_id;
  IF v_league_venue IS NULL THEN RAISE EXCEPTION 'league_not_found' USING ERRCODE='P0001'; END IF;

  -- venue callers may only touch their own league; platform_admin may touch any
  IF v_actor_type <> 'platform_admin' AND v_caller_venue IS DISTINCT FROM v_league_venue THEN
    RAISE EXCEPTION 'not_your_league' USING ERRCODE='P0001';
  END IF;

  -- light validation
  IF p_config ? 'num_periods'        AND (p_config->>'num_periods')::int        <= 0 THEN RAISE EXCEPTION 'invalid_num_periods' USING ERRCODE='P0001'; END IF;
  IF p_config ? 'period_length_mins' AND (p_config->>'period_length_mins')::int <= 0 THEN RAISE EXCEPTION 'invalid_period_length' USING ERRCODE='P0001'; END IF;
  IF p_config ? 'sin_bin_mins'       AND (p_config->>'sin_bin_mins')::int       <= 0 THEN RAISE EXCEPTION 'invalid_sin_bin_mins' USING ERRCODE='P0001'; END IF;

  v_names := CASE WHEN p_config ? 'period_names'
                  THEN ARRAY(SELECT jsonb_array_elements_text(p_config->'period_names')) END;

  -- UPDATE the league's row; INSERT if it doesn't exist yet (only provided keys change)
  UPDATE public.league_config SET
    num_periods        = COALESCE((p_config->>'num_periods')::int, num_periods),
    period_length_mins = COALESCE((p_config->>'period_length_mins')::int, period_length_mins),
    period_names       = COALESCE(v_names, period_names),
    match_duration_mins= COALESCE((p_config->>'match_duration_mins')::int, match_duration_mins),
    has_sin_bin        = COALESCE((p_config->>'has_sin_bin')::boolean, has_sin_bin),
    sin_bin_mins       = COALESCE((p_config->>'sin_bin_mins')::int, sin_bin_mins)
  WHERE league_id = p_league_id;

  IF NOT FOUND THEN
    INSERT INTO public.league_config
      (league_id, sport, format, num_periods, period_length_mins, period_names,
       match_duration_mins, has_sin_bin, sin_bin_mins)
    SELECT p_league_id, l.sport, l.format,
           (p_config->>'num_periods')::int,
           (p_config->>'period_length_mins')::int,
           v_names,
           COALESCE((p_config->>'match_duration_mins')::int, 40),
           COALESCE((p_config->>'has_sin_bin')::boolean, false),
           (p_config->>'sin_bin_mins')::int
    FROM public.leagues l WHERE l.id = p_league_id;
  END IF;

  INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_league_venue, v_actor_type, COALESCE(p_token,'platform_admin'), 'update_league_config', 'league', p_league_id,
    jsonb_build_object('config', p_config));

  RETURN (SELECT to_jsonb(lc) FROM public.league_config lc WHERE lc.league_id = p_league_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_league_config(text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_league_config(text, text, jsonb) TO anon, authenticated;
