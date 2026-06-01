-- 185_phase11_venue_persist_cup_bracket.sql
-- LEAGUE MODE — Phase 11 Cycle 11.1: bracket generation RPC (single-elimination).
--
-- venue_persist_cup_bracket is the cup equivalent of venue_generate_fixtures: it owns
-- the WHOLE bracket, not just round 1. The server is the single source of truth for the
-- bracket shape (the client cupBracket.js engine stays a cosmetic preview). It:
--   * computes the canonical single-elim seeding order (textbook mirror: size 8 →
--     1,8,4,5,2,7,3,6) so top seeds are spread and meet late;
--   * creates one cup_rounds row per round and one cup_ties row per slot in every round,
--     with explicit feeder edges (round r+1 slot j is fed by round r slots 2j / 2j+1);
--   * round-1 slots where both positions are real teams become a scheduled fixture
--     (round-robin across the supplied pitches), linked both ways (cup_ties.fixture_id +
--     fixtures.cup_tie_id); a slot paired with a BYE becomes a tie that is already
--     'decided' (winner = the real team, no fixture);
--   * raises fixture fee charges for the round-1 fixtures exactly like
--     venue_generate_fixtures (so cups bill identically).
--
-- Advancement (filling round 2+ from winners, incl. propagating byes) and round-2+
-- fixture creation are Cycle 11.2 — this RPC leaves rounds 2+ as pending ties with
-- feeder pointers only. Idempotent guard: refuses if the competition already has
-- fixtures or ties.
--
-- SECURITY DEFINER, granted to anon + authenticated (venue-token RPC, mirrors
-- venue_generate_fixtures). Writes a 'cup_bracket_generated' audit row (hard-rule #9).

CREATE OR REPLACE FUNCTION public.venue_persist_cup_bracket(
  p_venue_token       text,
  p_competition_id    uuid,
  p_scheduled_date    date,
  p_kickoff_time      time,
  p_playing_area_ids  uuid[] DEFAULT '{}'::uuid[],
  p_seed_team_ids     text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller        record;
  v_venue_id      text;
  v_comp          record;
  v_league_id     text;
  v_lc_slot       int;
  v_active        text[];
  v_ordered       text[];
  v_seed          text;
  v_t             text;
  v_n             int;
  v_size          int;
  v_rounds        int;
  v_order         int[];      -- seeding order, 1-based seed positions
  v_next          int[];
  v_pos           int;
  v_r             int;
  v_slot          int;
  v_slots         int;
  v_posH          int;
  v_posA          int;
  v_teamH         text;
  v_teamA         text;
  v_pitch_n       int;
  v_played_idx    int := 0;
  v_pitch         uuid;
  v_fixture_id    uuid;
  v_tie_id        uuid;
  v_round_name    text;
  v_remaining     int;
  v_tie_count     int := 0;
  v_fx_count      int := 0;
  v_bye_count     int := 0;
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
  IF v_comp.type <> 'cup' OR v_comp.format <> 'single_elimination' THEN
    RAISE EXCEPTION 'not_single_elim_cup' USING ERRCODE = 'P0001',
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
  SELECT lc.slot_minutes INTO v_lc_slot FROM league_config lc WHERE lc.league_id = v_league_id;

  -- Active teams in this competition.
  SELECT array_agg(team_id) INTO v_active
  FROM competition_teams
  WHERE competition_id = p_competition_id AND status = 'active';
  IF v_active IS NULL OR array_length(v_active, 1) < 2 THEN
    RAISE EXCEPTION 'competition_has_too_few_active_teams' USING ERRCODE = 'P0001';
  END IF;

  -- Ordered = supplied seeds first (only those actually active, in given order),
  -- then any remaining active teams.
  v_ordered := ARRAY[]::text[];
  IF p_seed_team_ids IS NOT NULL THEN
    FOREACH v_seed IN ARRAY p_seed_team_ids LOOP
      IF v_seed = ANY(v_active) AND NOT (v_seed = ANY(v_ordered)) THEN
        v_ordered := array_append(v_ordered, v_seed);
      END IF;
    END LOOP;
  END IF;
  FOREACH v_t IN ARRAY v_active LOOP
    IF NOT (v_t = ANY(v_ordered)) THEN
      v_ordered := array_append(v_ordered, v_t);
    END IF;
  END LOOP;

  v_n := array_length(v_ordered, 1);

  -- Bracket size = next power of two ≥ n; rounds = log2(size).
  v_size := 2;
  WHILE v_size < v_n LOOP v_size := v_size * 2; END LOOP;
  v_rounds := 0;
  v_pos := v_size;
  WHILE v_pos > 1 LOOP v_rounds := v_rounds + 1; v_pos := v_pos / 2; END LOOP;

  -- Canonical seeding order via the standard mirror fold.
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

  -- ── cup_rounds: one per round ─────────────────────────────────────────────
  FOR v_r IN 1..v_rounds LOOP
    v_remaining := v_rounds - v_r;
    v_round_name := CASE
      WHEN v_remaining = 0 THEN 'Final'
      WHEN v_remaining = 1 THEN 'Semi-final'
      WHEN v_remaining = 2 THEN 'Quarter-final'
      ELSE 'Round of ' || (2 ^ (v_remaining + 1))::int
    END;
    INSERT INTO cup_rounds (competition_id, round_number, round_name, num_teams, status)
    VALUES (p_competition_id, v_r, v_round_name, (v_size / (2 ^ (v_r - 1))::int), 'pending');
  END LOOP;

  -- ── Round 1 ties (+ fixtures for real pairings) ───────────────────────────
  v_slots := v_size / 2;
  v_round_name := CASE
    WHEN v_rounds - 1 = 0 THEN 'Final'
    WHEN v_rounds - 1 = 1 THEN 'Semi-final'
    WHEN v_rounds - 1 = 2 THEN 'Quarter-final'
    ELSE 'Round of ' || (2 ^ ((v_rounds - 1) + 1))::int
  END;
  FOR v_slot IN 0..(v_slots - 1) LOOP
    v_posH := v_order[2 * v_slot + 1];
    v_posA := v_order[2 * v_slot + 2];
    v_teamH := CASE WHEN v_posH <= v_n THEN v_ordered[v_posH] ELSE NULL END;
    v_teamA := CASE WHEN v_posA <= v_n THEN v_ordered[v_posA] ELSE NULL END;

    IF v_teamH IS NOT NULL AND v_teamA IS NOT NULL THEN
      -- real pairing → fixture
      IF v_pitch_n > 0 THEN
        v_pitch := p_playing_area_ids[(v_played_idx % v_pitch_n) + 1];
      ELSE
        v_pitch := NULL;
      END IF;
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
      -- bye (exactly one real team) → decided tie, no fixture
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

  -- ── Rounds 2..final: pending ties with feeder pointers only ───────────────
  FOR v_r IN 2..v_rounds LOOP
    v_remaining := v_rounds - v_r;
    v_round_name := CASE
      WHEN v_remaining = 0 THEN 'Final'
      WHEN v_remaining = 1 THEN 'Semi-final'
      WHEN v_remaining = 2 THEN 'Quarter-final'
      ELSE 'Round of ' || (2 ^ (v_remaining + 1))::int
    END;
    v_slots := v_size / (2 ^ v_r)::int;
    FOR v_slot IN 0..(v_slots - 1) LOOP
      INSERT INTO cup_ties (competition_id, round_number, slot_index, round_name,
                            home_source, away_source, home_feeder_slot, away_feeder_slot, status)
      VALUES (p_competition_id, v_r, v_slot, v_round_name,
              'winner', 'winner', 2 * v_slot, 2 * v_slot + 1, 'pending');
      v_tie_count := v_tie_count + 1;
    END LOOP;
  END LOOP;

  -- ── Fixture fee charges for round-1 fixtures (mirrors venue_generate_fixtures) ──
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

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'cup_bracket_generated', 'competition', p_competition_id::text,
          jsonb_build_object('league_id', v_league_id, 'season_id', v_comp.season_id,
            'teams', v_n, 'bracket_size', v_size, 'rounds', v_rounds,
            'ties', v_tie_count, 'round1_fixtures', v_fx_count, 'byes', v_bye_count));

  PERFORM public.notify_venue_change(v_venue_id, 'cup_bracket_generated');
  PERFORM public.notify_league_change(v_league_id, 'cup_bracket_generated');

  RETURN jsonb_build_object('ok', true, 'competition_id', p_competition_id,
    'teams', v_n, 'bracket_size', v_size, 'rounds', v_rounds,
    'ties', v_tie_count, 'round1_fixtures', v_fx_count, 'byes', v_bye_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_persist_cup_bracket(text, uuid, date, time, uuid[], text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_persist_cup_bracket(text, uuid, date, time, uuid[], text[]) TO anon, authenticated;
