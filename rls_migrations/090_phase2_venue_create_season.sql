-- 090_phase2_venue_create_season.sql
--
-- Phase 2 (League Mode) — Cycle 2.3 season setup RPC.
--
--   venue_create_season(p_venue_token, p_season jsonb)
--     Creates a season under one of the caller's leagues, plus the
--     competitions inside it (league + cup, single + parallel
--     supported).
--
-- p_season shape:
--   {
--     "league_id":     "l_xxx",          -- must belong to caller's venue
--     "name":          "2026 Spring",
--     "start_date":    "2026-04-01",     -- ISO date
--     "end_date":      "2026-07-31",     -- ISO date, > start_date
--     "num_weeks":     14,
--     "competitions":  [                 -- 1+ entries
--       {"name":"Spring League","type":"league","format":"round_robin"},
--       {"name":"Spring Cup",  "type":"cup",   "format":"single_elimination"}
--     ]
--   }
--
-- Returns:
--   {
--     "ok": true,
--     "season_id": "<uuid>",
--     "competitions": [{"id":"<uuid>","name":"...","type":"...","format":"..."}, ...]
--   }
--
-- Idempotent on retry: NO — re-running creates duplicate seasons.
-- Wizard layer is responsible for double-fire guard.

CREATE OR REPLACE FUNCTION public.venue_create_season(
  p_venue_token text,
  p_season jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_league_id text;
  v_season_id uuid;
  v_competitions jsonb := COALESCE(p_season->'competitions', '[]'::jsonb);
  v_result_comps jsonb := '[]'::jsonb;
  v_comp jsonb;
  v_comp_id uuid;
  v_comp_name text;
  v_comp_type text;
  v_comp_format text;
BEGIN
  -- Resolve caller
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Validate league
  v_league_id := p_season->>'league_id';
  IF v_league_id IS NULL OR length(trim(v_league_id)) = 0 THEN
    RAISE EXCEPTION 'league_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM leagues WHERE id = v_league_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'league_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  -- Validate season metadata
  IF (p_season->>'name') IS NULL OR length(trim(p_season->>'name')) = 0 THEN
    RAISE EXCEPTION 'season_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF (p_season->>'start_date') IS NULL OR (p_season->>'end_date') IS NULL THEN
    RAISE EXCEPTION 'season_dates_required' USING ERRCODE = 'P0001';
  END IF;
  IF (p_season->>'end_date')::date <= (p_season->>'start_date')::date THEN
    RAISE EXCEPTION 'season_end_before_start' USING ERRCODE = 'P0001';
  END IF;
  IF (p_season->>'num_weeks') IS NULL OR (p_season->>'num_weeks')::int < 1 THEN
    RAISE EXCEPTION 'season_num_weeks_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- Validate competitions array
  IF jsonb_array_length(v_competitions) = 0 THEN
    RAISE EXCEPTION 'competitions_required' USING ERRCODE = 'P0001';
  END IF;
  FOR v_comp IN SELECT * FROM jsonb_array_elements(v_competitions) LOOP
    IF (v_comp->>'name') IS NULL OR length(trim(v_comp->>'name')) = 0 THEN
      RAISE EXCEPTION 'competition_name_required' USING ERRCODE = 'P0001';
    END IF;
    IF (v_comp->>'type') NOT IN ('league','cup') THEN
      RAISE EXCEPTION 'competition_type_invalid' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Insert season
  INSERT INTO seasons (league_id, name, start_date, end_date, num_weeks, status)
  VALUES (
    v_league_id,
    trim(p_season->>'name'),
    (p_season->>'start_date')::date,
    (p_season->>'end_date')::date,
    (p_season->>'num_weeks')::int,
    'setup'
  )
  RETURNING id INTO v_season_id;

  -- Insert competitions
  FOR v_comp IN SELECT * FROM jsonb_array_elements(v_competitions) LOOP
    v_comp_name   := trim(v_comp->>'name');
    v_comp_type   := v_comp->>'type';
    v_comp_format := v_comp->>'format';

    INSERT INTO competitions (season_id, name, type, format, status)
    VALUES (v_season_id, v_comp_name, v_comp_type, v_comp_format, 'setup')
    RETURNING id INTO v_comp_id;

    v_result_comps := v_result_comps || jsonb_build_object(
      'id', v_comp_id,
      'name', v_comp_name,
      'type', v_comp_type,
      'format', v_comp_format
    );
  END LOOP;

  -- Audit
  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'season_created', 'venue', v_venue_id,
    jsonb_build_object(
      'season_id', v_season_id,
      'season_name', trim(p_season->>'name'),
      'league_id', v_league_id,
      'competition_count', jsonb_array_length(v_competitions),
      'start_date', p_season->>'start_date',
      'end_date', p_season->>'end_date'
    )
  );

  -- Broadcast
  PERFORM public.notify_venue_change(v_venue_id, 'season_created');
  PERFORM public.notify_league_change(v_league_id, 'season_created');

  RETURN jsonb_build_object(
    'ok', true,
    'season_id', v_season_id,
    'competitions', v_result_comps
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_create_season(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_season(text, jsonb)
  TO anon, authenticated;
