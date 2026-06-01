-- mig 192 — Phase 11.4a: venue_persist_group_stage (WRITE).
-- Draws active teams into N groups (snake by registration order, or operator-supplied
-- assignments), generates a single round-robin within each group server-side (circle method),
-- tags each fixture with group_label, creates fixture-fee charges, and stores the cup config.
-- Mirrors venue_persist_cup_bracket's guards/charge/audit shape. SECDEF, venue-token, anon+auth.

CREATE OR REPLACE FUNCTION public.venue_persist_group_stage(
  p_venue_token         text,
  p_competition_id      uuid,
  p_num_groups          int,
  p_qualifiers_per_group int,
  p_scheduled_date      date,
  p_kickoff_time        time,
  p_playing_area_ids    uuid[] DEFAULT '{}'::uuid[],
  p_group_assignments   jsonb  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_comp      record;
  v_league_id text;
  v_active    text[];
  v_n         int;
  v_t         text;
  v_i         int;
  v_g         int;
  v_dir       int;
  v_label     text;
  v_labels    text[];
  v_group_of  jsonb := '{}'::jsonb;   -- team_id -> group_label
  v_seed_of   jsonb := '{}'::jsonb;   -- team_id -> seed
  v_pitch_n   int;
  v_played_idx int := 0;
  v_grp       text;
  v_arr       text[];
  v_pad       int;
  v_gn        int;
  v_half      int;
  v_round     int;
  v_h         text;
  v_a         text;
  v_fixed     text;
  v_rest      text[];
  v_pitch     uuid;
  v_date      date;
  v_fx_count  int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_competition_id IS NULL THEN
    RAISE EXCEPTION 'competition_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_scheduled_date IS NULL OR p_kickoff_time IS NULL THEN
    RAISE EXCEPTION 'schedule_required' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_num_groups,0) < 1 OR COALESCE(p_qualifiers_per_group,0) < 1 THEN
    RAISE EXCEPTION 'invalid_group_config' USING ERRCODE = 'P0001';
  END IF;
  IF p_num_groups > 26 THEN
    RAISE EXCEPTION 'too_many_groups' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.id, c.type, c.format, c.season_id, s.league_id, s.start_date, s.end_date,
         l.venue_id AS l_venue
  INTO v_comp
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE c.id = p_competition_id;

  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp.l_venue <> v_venue_id THEN
    RAISE EXCEPTION 'competition_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp.type <> 'cup' OR v_comp.format <> 'group_stage' THEN
    RAISE EXCEPTION 'not_group_stage_cup' USING ERRCODE = 'P0001',
      DETAIL = v_comp.type || '/' || COALESCE(v_comp.format, 'null');
  END IF;
  IF p_scheduled_date < v_comp.start_date OR p_scheduled_date > v_comp.end_date THEN
    RAISE EXCEPTION 'date_outside_season' USING ERRCODE = 'P0001', DETAIL = p_scheduled_date::text;
  END IF;
  IF EXISTS (SELECT 1 FROM fixtures WHERE competition_id = p_competition_id)
     OR EXISTS (SELECT 1 FROM cup_ties WHERE competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'bracket_already_exists' USING ERRCODE = 'P0001';
  END IF;

  v_league_id := v_comp.league_id;

  -- active teams in stable registration order
  SELECT array_agg(team_id ORDER BY registered_at, team_id) INTO v_active
  FROM competition_teams
  WHERE competition_id = p_competition_id AND status = 'active';
  v_n := COALESCE(array_length(v_active, 1), 0);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'competition_has_too_few_active_teams' USING ERRCODE = 'P0001';
  END IF;
  IF p_num_groups > v_n THEN
    RAISE EXCEPTION 'more_groups_than_teams' USING ERRCODE = 'P0001';
  END IF;

  -- group labels A..(A+num_groups-1)
  v_labels := ARRAY[]::text[];
  FOR v_g IN 1..p_num_groups LOOP
    v_labels := array_append(v_labels, chr(64 + v_g));
  END LOOP;

  -- assignment: explicit override OR snake draw
  IF p_group_assignments IS NOT NULL THEN
    IF jsonb_typeof(p_group_assignments) <> 'object' THEN
      RAISE EXCEPTION 'bad_group_assignments' USING ERRCODE = 'P0001';
    END IF;
    -- every active team must be present exactly once with a valid label
    FOR v_i IN 1..v_n LOOP
      v_t := v_active[v_i];
      v_label := p_group_assignments->>v_t;
      IF v_label IS NULL OR NOT (v_label = ANY(v_labels)) THEN
        RAISE EXCEPTION 'team_unassigned_or_bad_group' USING ERRCODE = 'P0001', DETAIL = v_t;
      END IF;
      v_group_of := jsonb_set(v_group_of, ARRAY[v_t], to_jsonb(v_label));
      v_seed_of  := jsonb_set(v_seed_of,  ARRAY[v_t], to_jsonb(v_i));
    END LOOP;
    -- reject any assignment key that isn't an active team
    IF (SELECT count(*) FROM jsonb_object_keys(p_group_assignments)) <> v_n THEN
      RAISE EXCEPTION 'group_assignments_team_mismatch' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- snake draw across groups in registration order
    v_g := 1; v_dir := 1;
    FOR v_i IN 1..v_n LOOP
      v_t := v_active[v_i];
      v_group_of := jsonb_set(v_group_of, ARRAY[v_t], to_jsonb(v_labels[v_g]));
      v_seed_of  := jsonb_set(v_seed_of,  ARRAY[v_t], to_jsonb(v_i));
      -- advance snake pointer
      IF p_num_groups = 1 THEN
        v_g := 1;
      ELSIF v_dir = 1 THEN
        IF v_g = p_num_groups THEN v_dir := -1; ELSE v_g := v_g + 1; END IF;
      ELSE
        IF v_g = 1 THEN v_dir := 1; ELSE v_g := v_g - 1; END IF;
      END IF;
    END LOOP;
  END IF;

  -- each group must have at least qualifiers_per_group teams
  FOREACH v_label IN ARRAY v_labels LOOP
    IF (SELECT count(*) FROM jsonb_each_text(v_group_of) WHERE value = v_label) < p_qualifiers_per_group THEN
      RAISE EXCEPTION 'group_too_small_for_qualifiers' USING ERRCODE = 'P0001', DETAIL = v_label;
    END IF;
  END LOOP;

  -- persist group_label + seed
  FOR v_i IN 1..v_n LOOP
    v_t := v_active[v_i];
    UPDATE competition_teams
      SET group_label = v_group_of->>v_t, seed = (v_seed_of->>v_t)::int
      WHERE competition_id = p_competition_id AND team_id = v_t;
  END LOOP;

  v_pitch_n := COALESCE(array_length(p_playing_area_ids, 1), 0);

  -- round-robin per group (circle method); round N played p_scheduled_date + (N-1)*7
  FOREACH v_grp IN ARRAY v_labels LOOP
    SELECT array_agg(team_id ORDER BY seed) INTO v_arr
    FROM competition_teams
    WHERE competition_id = p_competition_id AND group_label = v_grp;
    v_gn := COALESCE(array_length(v_arr, 1), 0);
    IF v_gn < 2 THEN CONTINUE; END IF;

    v_pad := v_gn;
    IF v_gn % 2 = 1 THEN v_arr := array_append(v_arr, NULL::text); v_pad := v_gn + 1; END IF;
    v_half := v_pad / 2;

    FOR v_round IN 1..(v_pad - 1) LOOP
      v_date := p_scheduled_date + ((v_round - 1) * 7);
      FOR v_i IN 1..v_half LOOP
        v_h := v_arr[v_i];
        v_a := v_arr[v_pad - v_i + 1];
        IF v_h IS NULL OR v_a IS NULL THEN CONTINUE; END IF;
        -- alternate home/away by round parity for fairness
        IF v_round % 2 = 0 THEN v_t := v_h; v_h := v_a; v_a := v_t; END IF;
        v_pitch := CASE WHEN v_pitch_n > 0
                        THEN p_playing_area_ids[(v_played_idx % v_pitch_n) + 1]
                        ELSE NULL END;
        INSERT INTO fixtures (competition_id, home_team_id, away_team_id, week_number,
                              round_name, group_label, scheduled_date, kickoff_time,
                              playing_area_id, status)
        VALUES (p_competition_id, v_h, v_a, v_round,
                'Group ' || v_grp || ' - Round ' || v_round, v_grp,
                v_date, p_kickoff_time, v_pitch, 'scheduled');
        v_played_idx := v_played_idx + 1;
        v_fx_count := v_fx_count + 1;
      END LOOP;
      -- rotate: keep v_arr[1] fixed, rotate the rest right by 1
      v_fixed := v_arr[1];
      v_rest  := v_arr[2:v_pad];
      v_rest  := array_prepend(v_rest[array_length(v_rest,1)], v_rest[1:array_length(v_rest,1)-1]);
      v_arr   := array_prepend(v_fixed, v_rest);
    END LOOP;
  END LOOP;

  -- fixture-fee charges (same block as venue_generate_fixtures / venue_persist_cup_bracket)
  INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  SELECT v_venue_id, 'fixture', f.id::text, tm.team_id, f.competition_id,
         lc.fixture_fee_pence, 'unpaid', f.scheduled_date
  FROM fixtures f
  JOIN league_config lc ON lc.league_id = v_league_id
  CROSS JOIN LATERAL (
    SELECT f.home_team_id AS team_id
    UNION ALL
    SELECT f.away_team_id WHERE COALESCE(lc.fixture_fee_payer, 'both') = 'both'
  ) tm
  WHERE f.competition_id = p_competition_id
    AND tm.team_id IS NOT NULL
    AND COALESCE(lc.fixture_fee_pence, 0) > 0
  ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;

  -- store config
  UPDATE competitions
    SET config = jsonb_build_object(
      'num_groups', p_num_groups,
      'qualifiers_per_group', p_qualifiers_per_group,
      'knockout_seeded', false)
    WHERE id = p_competition_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'group_stage_generated', 'competition', p_competition_id::text,
          jsonb_build_object('league_id', v_league_id, 'season_id', v_comp.season_id,
            'teams', v_n, 'num_groups', p_num_groups,
            'qualifiers_per_group', p_qualifiers_per_group, 'fixtures', v_fx_count));

  PERFORM public.notify_venue_change(v_venue_id, 'fixtures_generated');
  PERFORM public.notify_league_change(v_league_id, 'fixtures_generated');

  RETURN jsonb_build_object('ok', true, 'competition_id', p_competition_id,
    'teams', v_n, 'num_groups', p_num_groups,
    'qualifiers_per_group', p_qualifiers_per_group, 'fixtures', v_fx_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_persist_group_stage(text, uuid, int, int, date, time, uuid[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_persist_group_stage(text, uuid, int, int, date, time, uuid[], jsonb) TO anon, authenticated;
