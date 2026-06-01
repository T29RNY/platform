-- mig 194 — Phase 11.4b: knockout-from-groups.
-- 1) Extract the bracket-build tail of venue_persist_cup_bracket into _cup_build_bracket
--    (shared by single-elim seeding AND group-qualifier seeding — no copy-paste).
-- 2) venue_persist_cup_bracket becomes a thin caller (behaviour byte-identical).
-- 3) venue_seed_knockout_from_groups: operator "Build knockout" — seeds the bracket from
--    final group standings (cross-group: all winners, then all runners-up, …).

-- ── 1. internal builder ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cup_build_bracket(
  p_competition_id uuid,
  p_ordered        text[],
  p_scheduled_date date,
  p_kickoff_time   time,
  p_playing_area_ids uuid[],
  p_venue_id       text,
  p_league_id      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n int; v_size int; v_rounds int;
  v_order int[]; v_next int[]; v_pos int;
  v_r int; v_slot int; v_slots int;
  v_posH int; v_posA int; v_teamH text; v_teamA text;
  v_pitch_n int; v_played_idx int := 0; v_pitch uuid;
  v_fixture_id uuid; v_tie_id uuid; v_round_name text; v_remaining int;
  v_tie_count int := 0; v_fx_count int := 0; v_bye_count int := 0;
BEGIN
  v_n := array_length(p_ordered, 1);
  IF v_n IS NULL OR v_n < 2 THEN RAISE EXCEPTION 'too_few_teams_for_bracket' USING ERRCODE='P0001'; END IF;

  v_size := 2;
  WHILE v_size < v_n LOOP v_size := v_size * 2; END LOOP;
  v_rounds := 0; v_pos := v_size;
  WHILE v_pos > 1 LOOP v_rounds := v_rounds + 1; v_pos := v_pos / 2; END LOOP;

  -- canonical mirror seeding order
  v_order := ARRAY[1];
  WHILE array_length(v_order, 1) < v_size LOOP
    v_next := ARRAY[]::int[];
    FOREACH v_pos IN ARRAY v_order LOOP
      v_next := v_next || v_pos;
      v_next := v_next || (array_length(v_order, 1) * 2 + 1 - v_pos);
    END LOOP;
    v_order := v_next;
  END LOOP;

  v_pitch_n := COALESCE(array_length(p_playing_area_ids, 1), 0);

  FOR v_r IN 1..v_rounds LOOP
    v_remaining := v_rounds - v_r;
    v_round_name := CASE
      WHEN v_remaining = 0 THEN 'Final'
      WHEN v_remaining = 1 THEN 'Semi-final'
      WHEN v_remaining = 2 THEN 'Quarter-final'
      ELSE 'Round of ' || (2 ^ (v_remaining + 1))::int END;
    INSERT INTO cup_rounds (competition_id, round_number, round_name, num_teams, status)
    VALUES (p_competition_id, v_r, v_round_name, (v_size / (2 ^ (v_r - 1))::int), 'pending');
  END LOOP;

  -- round 1: real ties (ready + fixture) or byes (decided)
  v_slots := v_size / 2;
  v_round_name := CASE
    WHEN v_rounds - 1 = 0 THEN 'Final'
    WHEN v_rounds - 1 = 1 THEN 'Semi-final'
    WHEN v_rounds - 1 = 2 THEN 'Quarter-final'
    ELSE 'Round of ' || (2 ^ ((v_rounds - 1) + 1))::int END;
  FOR v_slot IN 0..(v_slots - 1) LOOP
    v_posH := v_order[2 * v_slot + 1];
    v_posA := v_order[2 * v_slot + 2];
    v_teamH := CASE WHEN v_posH <= v_n THEN p_ordered[v_posH] ELSE NULL END;
    v_teamA := CASE WHEN v_posA <= v_n THEN p_ordered[v_posA] ELSE NULL END;

    IF v_teamH IS NOT NULL AND v_teamA IS NOT NULL THEN
      v_pitch := CASE WHEN v_pitch_n > 0 THEN p_playing_area_ids[(v_played_idx % v_pitch_n) + 1] ELSE NULL END;
      INSERT INTO fixtures (competition_id, home_team_id, away_team_id, week_number,
                            round_name, scheduled_date, kickoff_time, playing_area_id, status)
      VALUES (p_competition_id, v_teamH, v_teamA, 1, v_round_name,
              p_scheduled_date, p_kickoff_time, v_pitch, 'scheduled')
      RETURNING id INTO v_fixture_id;

      INSERT INTO cup_ties (competition_id, round_number, slot_index, round_name, fixture_id,
                            home_team_id, away_team_id, home_source, away_source, status)
      VALUES (p_competition_id, 1, v_slot, v_round_name, v_fixture_id,
              v_teamH, v_teamA, 'seed', 'seed', 'ready')
      RETURNING id INTO v_tie_id;

      UPDATE fixtures SET cup_tie_id = v_tie_id WHERE id = v_fixture_id;
      v_played_idx := v_played_idx + 1;
      v_fx_count := v_fx_count + 1;
    ELSE
      INSERT INTO cup_ties (competition_id, round_number, slot_index, round_name,
                            home_team_id, away_team_id, home_source, away_source,
                            winner_team_id, status)
      VALUES (p_competition_id, 1, v_slot, v_round_name,
              COALESCE(v_teamH, v_teamA), NULL,
              CASE WHEN v_teamH IS NOT NULL THEN 'seed' ELSE 'bye' END, 'bye',
              COALESCE(v_teamH, v_teamA), 'decided');
      v_bye_count := v_bye_count + 1;
    END IF;
    v_tie_count := v_tie_count + 1;
  END LOOP;

  -- rounds 2+: pending ties with feeder pointers
  FOR v_r IN 2..v_rounds LOOP
    v_remaining := v_rounds - v_r;
    v_round_name := CASE
      WHEN v_remaining = 0 THEN 'Final'
      WHEN v_remaining = 1 THEN 'Semi-final'
      WHEN v_remaining = 2 THEN 'Quarter-final'
      ELSE 'Round of ' || (2 ^ (v_remaining + 1))::int END;
    v_slots := v_size / (2 ^ v_r)::int;
    FOR v_slot IN 0..(v_slots - 1) LOOP
      INSERT INTO cup_ties (competition_id, round_number, slot_index, round_name,
                            home_source, away_source, home_feeder_slot, away_feeder_slot, status)
      VALUES (p_competition_id, v_r, v_slot, v_round_name,
              'winner', 'winner', 2 * v_slot, 2 * v_slot + 1, 'pending');
      v_tie_count := v_tie_count + 1;
    END LOOP;
  END LOOP;

  -- round-1 fee charges (ON CONFLICT skips any pre-existing group-stage charges)
  INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  SELECT p_venue_id, 'fixture', f.id::text, tm.team_id, f.competition_id,
         lc.fixture_fee_pence, 'unpaid', f.scheduled_date
  FROM fixtures f
  JOIN league_config lc ON lc.league_id = p_league_id
  CROSS JOIN LATERAL (
    SELECT f.home_team_id AS team_id
    UNION ALL
    SELECT f.away_team_id WHERE COALESCE(lc.fixture_fee_payer, 'both') = 'both'
  ) tm
  WHERE f.competition_id = p_competition_id
    AND tm.team_id IS NOT NULL
    AND COALESCE(lc.fixture_fee_pence, 0) > 0
  ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;

  RETURN jsonb_build_object('bracket_size', v_size, 'rounds', v_rounds,
    'ties', v_tie_count, 'round1_fixtures', v_fx_count, 'byes', v_bye_count);
END;
$function$;

REVOKE ALL ON FUNCTION public._cup_build_bracket(uuid, text[], date, time, uuid[], text, text) FROM PUBLIC, anon, authenticated;

-- ── 2. venue_persist_cup_bracket — thin caller (behaviour unchanged) ────────────
CREATE OR REPLACE FUNCTION public.venue_persist_cup_bracket(
  p_venue_token text, p_competition_id uuid, p_scheduled_date date,
  p_kickoff_time time without time zone, p_playing_area_ids uuid[] DEFAULT '{}'::uuid[],
  p_seed_team_ids text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_comp record; v_league_id text;
  v_active text[]; v_ordered text[]; v_seed text; v_t text; v_n int;
  v_build jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_competition_id IS NULL THEN RAISE EXCEPTION 'competition_id_required' USING ERRCODE='P0001'; END IF;
  IF p_scheduled_date IS NULL OR p_kickoff_time IS NULL THEN RAISE EXCEPTION 'schedule_required' USING ERRCODE='P0001'; END IF;

  SELECT c.id, c.type, c.format, c.season_id, s.league_id, s.start_date, s.end_date, l.venue_id AS l_venue
  INTO v_comp
  FROM competitions c JOIN seasons s ON s.id = c.season_id JOIN leagues l ON l.id = s.league_id
  WHERE c.id = p_competition_id;

  IF v_comp.id IS NULL THEN RAISE EXCEPTION 'competition_not_found' USING ERRCODE='P0001'; END IF;
  IF v_comp.l_venue <> v_venue_id THEN RAISE EXCEPTION 'competition_not_in_venue' USING ERRCODE='P0001'; END IF;
  IF v_comp.type <> 'cup' OR v_comp.format <> 'single_elimination' THEN
    RAISE EXCEPTION 'not_single_elim_cup' USING ERRCODE='P0001', DETAIL = v_comp.type || '/' || COALESCE(v_comp.format,'null');
  END IF;
  IF p_scheduled_date < v_comp.start_date OR p_scheduled_date > v_comp.end_date THEN
    RAISE EXCEPTION 'date_outside_season' USING ERRCODE='P0001', DETAIL = p_scheduled_date::text;
  END IF;
  IF EXISTS (SELECT 1 FROM fixtures WHERE competition_id = p_competition_id)
     OR EXISTS (SELECT 1 FROM cup_ties WHERE competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'bracket_already_exists' USING ERRCODE='P0001';
  END IF;

  v_league_id := v_comp.league_id;

  SELECT array_agg(team_id) INTO v_active
  FROM competition_teams WHERE competition_id = p_competition_id AND status = 'active';
  IF v_active IS NULL OR array_length(v_active, 1) < 2 THEN
    RAISE EXCEPTION 'competition_has_too_few_active_teams' USING ERRCODE='P0001';
  END IF;

  -- ordered = seeds first (validated), then remaining active teams
  v_ordered := ARRAY[]::text[];
  IF p_seed_team_ids IS NOT NULL THEN
    FOREACH v_seed IN ARRAY p_seed_team_ids LOOP
      IF v_seed = ANY(v_active) AND NOT (v_seed = ANY(v_ordered)) THEN
        v_ordered := array_append(v_ordered, v_seed);
      END IF;
    END LOOP;
  END IF;
  FOREACH v_t IN ARRAY v_active LOOP
    IF NOT (v_t = ANY(v_ordered)) THEN v_ordered := array_append(v_ordered, v_t); END IF;
  END LOOP;
  v_n := array_length(v_ordered, 1);

  v_build := public._cup_build_bracket(p_competition_id, v_ordered, p_scheduled_date,
                                       p_kickoff_time, p_playing_area_ids, v_venue_id, v_league_id);

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'cup_bracket_generated', 'competition', p_competition_id::text,
          jsonb_build_object('league_id', v_league_id, 'season_id', v_comp.season_id, 'teams', v_n) || v_build);

  PERFORM public.notify_venue_change(v_venue_id, 'cup_bracket_generated');
  PERFORM public.notify_league_change(v_league_id, 'cup_bracket_generated');

  RETURN jsonb_build_object('ok', true, 'competition_id', p_competition_id, 'teams', v_n) || v_build;
END;
$function$;

-- ── 3. venue_seed_knockout_from_groups ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_seed_knockout_from_groups(
  p_venue_token text, p_competition_id uuid,
  p_scheduled_date date, p_kickoff_time time,
  p_playing_area_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_comp record; v_league_id text;
  v_gs jsonb; v_ordered text[]; v_n int; v_build jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_competition_id IS NULL THEN RAISE EXCEPTION 'competition_id_required' USING ERRCODE='P0001'; END IF;
  IF p_scheduled_date IS NULL OR p_kickoff_time IS NULL THEN RAISE EXCEPTION 'schedule_required' USING ERRCODE='P0001'; END IF;

  SELECT c.id, c.type, c.format, c.config, c.season_id, s.league_id, s.start_date, s.end_date, l.venue_id AS l_venue
  INTO v_comp
  FROM competitions c JOIN seasons s ON s.id = c.season_id JOIN leagues l ON l.id = s.league_id
  WHERE c.id = p_competition_id;

  IF v_comp.id IS NULL THEN RAISE EXCEPTION 'competition_not_found' USING ERRCODE='P0001'; END IF;
  IF v_comp.l_venue <> v_venue_id THEN RAISE EXCEPTION 'competition_not_in_venue' USING ERRCODE='P0001'; END IF;
  IF v_comp.type <> 'cup' OR v_comp.format <> 'group_stage' THEN
    RAISE EXCEPTION 'not_group_stage_cup' USING ERRCODE='P0001', DETAIL = v_comp.type || '/' || COALESCE(v_comp.format,'null');
  END IF;
  IF COALESCE((v_comp.config->>'knockout_seeded')::boolean, false) THEN
    RAISE EXCEPTION 'knockout_already_seeded' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM cup_ties WHERE competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'bracket_already_exists' USING ERRCODE='P0001';
  END IF;

  v_league_id := v_comp.league_id;

  v_gs := public.get_group_standings(p_competition_id);
  IF NOT COALESCE((v_gs->>'all_groups_complete')::boolean, false) THEN
    RAISE EXCEPTION 'group_stage_incomplete' USING ERRCODE='P0001';
  END IF;

  -- qualifiers in cross-group seeded order: all rank-1 (by group), then all rank-2, …
  SELECT array_agg(s->>'team_id' ORDER BY (s->>'rank')::int, g->>'group_label')
  INTO v_ordered
  FROM jsonb_array_elements(v_gs->'groups') g,
       jsonb_array_elements(g->'standings') s
  WHERE (s->>'qualifying')::boolean;

  v_n := COALESCE(array_length(v_ordered, 1), 0);
  IF v_n < 2 THEN RAISE EXCEPTION 'too_few_qualifiers' USING ERRCODE='P0001'; END IF;

  v_build := public._cup_build_bracket(p_competition_id, v_ordered, p_scheduled_date,
                                       p_kickoff_time, p_playing_area_ids, v_venue_id, v_league_id);

  UPDATE competitions SET config = jsonb_set(COALESCE(config,'{}'::jsonb), '{knockout_seeded}', 'true'::jsonb)
  WHERE id = p_competition_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'knockout_seeded_from_groups', 'competition', p_competition_id::text,
          jsonb_build_object('league_id', v_league_id, 'qualifiers', v_n) || v_build);

  PERFORM public.notify_venue_change(v_venue_id, 'cup_bracket_generated');
  PERFORM public.notify_league_change(v_league_id, 'cup_bracket_generated');

  RETURN jsonb_build_object('ok', true, 'competition_id', p_competition_id, 'qualifiers', v_n) || v_build;
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_seed_knockout_from_groups(text, uuid, date, time, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_seed_knockout_from_groups(text, uuid, date, time, uuid[]) TO anon, authenticated;

-- ── 4. get_cup_bracket additive extension: groups + all_groups_complete + knockout_seeded ──
CREATE OR REPLACE FUNCTION public.get_cup_bracket(p_competition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp record; v_champion jsonb; v_max_round int;
  v_groups jsonb := '[]'::jsonb; v_all_complete boolean := false; v_seeded boolean := false;
  v_result jsonb;
BEGIN
  IF p_competition_id IS NULL THEN RAISE EXCEPTION 'competition_id_required' USING ERRCODE='P0001'; END IF;
  SELECT id, name, type, format, status, config INTO v_comp FROM competitions WHERE id = p_competition_id;
  IF v_comp.id IS NULL THEN RAISE EXCEPTION 'competition_not_found' USING ERRCODE='P0001'; END IF;

  IF v_comp.format = 'group_stage' THEN
    v_groups := COALESCE((public.get_group_standings(p_competition_id))->'groups', '[]'::jsonb);
    v_all_complete := COALESCE(((public.get_group_standings(p_competition_id))->>'all_groups_complete')::boolean, false);
    v_seeded := COALESCE((v_comp.config->>'knockout_seeded')::boolean, false);
  END IF;

  SELECT max(round_number) INTO v_max_round FROM cup_ties WHERE competition_id = p_competition_id;
  SELECT to_jsonb(t) INTO v_champion FROM (
    SELECT w.id, w.name FROM cup_ties ct JOIN teams w ON w.id = ct.winner_team_id
    WHERE ct.competition_id = p_competition_id AND ct.status = 'decided' AND ct.round_number = v_max_round LIMIT 1
  ) t;

  SELECT jsonb_build_object(
    'competition', jsonb_build_object('id', v_comp.id, 'name', v_comp.name, 'type', v_comp.type, 'format', v_comp.format, 'status', v_comp.status),
    'champion', v_champion,
    'groups', v_groups,
    'all_groups_complete', v_all_complete,
    'knockout_seeded', v_seeded,
    'rounds', COALESCE((
      SELECT jsonb_agg(r ORDER BY (r->>'round_number')::int)
      FROM (
        SELECT jsonb_build_object(
          'round_number', ct.round_number, 'round_name', max(ct.round_name),
          'ties', jsonb_agg(jsonb_build_object(
            'id', ct.id, 'slot_index', ct.slot_index, 'status', ct.status,
            'home_team_id', ct.home_team_id, 'home_team_name', ht.name, 'home_primary_colour', ht.primary_colour,
            'away_team_id', ct.away_team_id, 'away_team_name', at.name, 'away_primary_colour', at.primary_colour,
            'home_source', ct.home_source, 'away_source', ct.away_source, 'winner_team_id', ct.winner_team_id,
            'fixture_id', ct.fixture_id, 'scheduled_date', f.scheduled_date, 'kickoff_time', f.kickoff_time,
            'fixture_status', f.status, 'home_score', f.home_score, 'away_score', f.away_score,
            'aet_home_score', f.aet_home_score, 'aet_away_score', f.aet_away_score,
            'pens_home_score', f.pens_home_score, 'pens_away_score', f.pens_away_score, 'decided_by', f.decided_by
          ) ORDER BY ct.slot_index)
        ) AS r
        FROM cup_ties ct
        LEFT JOIN teams ht ON ht.id = ct.home_team_id
        LEFT JOIN teams at ON at.id = ct.away_team_id
        LEFT JOIN fixtures f ON f.id = ct.fixture_id
        WHERE ct.competition_id = p_competition_id
        GROUP BY ct.round_number
      ) sub
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
