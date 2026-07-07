-- 491_self_serve_seed_single_elim.sql
--
-- Standalone Tournament Self-Serve epic — PR #4b, the ONE net-new seeder RPC.
--
-- THE GAP (found in the PR #4b deep audit): the self-serve default format
-- 'knockout' → competitions(type='cup', format='single_elimination') is
-- TOURNAMENT-MODE (tournament_event_id-scoped fixtures, home_competition_team_id
-- + knockout feeder wiring, advanced by _advance_tournament_winner, scored by
-- self_serve_enter_result mig 490). But the tournament-mode seeder suite (mig 452)
-- ships ONLY:
--   * venue_generate_schedule  → round-robin fixtures            (round_robin ✓)
--   * venue_seed_knockout      → groups→KO, requires ≥2 groups   (group_stage ✓)
--   * venue_seed_double_elimination
-- There is NO tournament-mode seeder that builds a straight knockout bracket from
-- a flat list of teams — so the DEFAULT self-serve format was un-startable.
--
-- The phase-11 cup-bracket seeder (venue_persist_cup_bracket, mig 185) is the
-- WRONG subsystem: it is LEAGUE-mode (cup_ties/cup_rounds, fixtures.home_team_id
-- text ids) and its fixtures cannot be scored by self_serve_enter_result. So a
-- new tournament-mode seeder is required — but it is SMALL: venue_seed_knockout's
-- bracket-building loop (452:1201-1249) is already format-agnostic and writes
-- exactly the feeder-wired fixtures mig 490 advances. The only groups-specific
-- part is the standings CTE that derives qualifiers; here we read the active
-- teams directly instead.
--
-- BRACKET SIZE: straight single-elim requires a power-of-2 field (2/4/8/16) — the
-- same constraint venue_seed_knockout already enforces on its qualifier set. Odd
-- counts are steered to round_robin (any N) or group_stage (groups absorb the
-- remainder) in the UI; byes are a deferred v1 edge, named not silent.
--
-- AUTH: Stage-1b venue_id-as-token via _authorise_venue_tournament(venue_id,
-- tournament_event_id) — identical surface to venue_seed_knockout / mig 490.
-- Bystander passing someone else's venue_id → invalid_venue_token / not_authorised.
--
-- SEEDING: no seed ranks exist for a self-serve cup, so teams are paired in
-- registration order (registered_at, then team_name) with the standard 1-vs-N mirror
-- (v_teams[i] vs v_teams[n-i+1]). Deterministic and fair-enough for v1.

CREATE OR REPLACE FUNCTION public.self_serve_seed_single_elim(
  p_venue_token         text,
  p_tournament_event_id uuid,
  p_competition_id      uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auth          record;
  v_comp_format   text;
  v_teams         uuid[];
  v_n             int;
  v_num_rounds    int;
  v_max_week      int;
  v_current_batch uuid[] := '{}';
  v_next_batch    uuid[] := '{}';
  v_fx_id         uuid;
  i               int;
  j               int;
  v_round_num     int;
  v_batch_size    int;
  v_rnames        text[] := ARRAY['Final','Semi-Finals','Quarter-Finals','Round of 16'];
BEGIN
  -- Authorise: caller owns this tournament's venue (Stage-1b re-checks auth.uid()).
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, p_tournament_event_id);

  -- Competition must belong to the event AND be a single-elimination cup.
  SELECT c.format INTO v_comp_format
  FROM public.competitions c
  WHERE c.id = p_competition_id AND c.tournament_event_id = p_tournament_event_id;

  IF v_comp_format IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp_format <> 'single_elimination' THEN
    RAISE EXCEPTION 'not_single_elimination' USING ERRCODE = 'P0001',
      DETAIL = 'competition format is ' || v_comp_format;
  END IF;

  -- Idempotency: refuse a double-seed (config flag OR any existing fixtures).
  IF COALESCE((SELECT (config->>'knockout_seeded')::boolean FROM public.competitions WHERE id = p_competition_id), false) THEN
    RAISE EXCEPTION 'knockout_already_seeded' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixtures WHERE competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'knockout_already_seeded' USING ERRCODE = 'P0001';
  END IF;

  -- Read the approved (active) teams directly — no group_label needed. This is
  -- the ONLY substantive difference from venue_seed_knockout: a flat field, not
  -- group qualifiers.
  SELECT ARRAY(
    SELECT id FROM public.competition_teams
    WHERE competition_id = p_competition_id AND status = 'active'
    ORDER BY registered_at, team_name
  ) INTO v_teams;

  v_n := COALESCE(array_length(v_teams, 1), 0);

  -- Power-of-2 field required (2/4/8/16). Odd counts belong in round_robin or
  -- group_stage — the UI steers them there before this RPC is ever reached.
  IF v_n < 2 OR (v_n & (v_n - 1)) <> 0 THEN
    RAISE EXCEPTION 'bracket_size_not_supported' USING ERRCODE = 'P0001',
      DETAIL = v_n::text || ' teams — straight knockout needs 4, 8 or 16 (a power of 2)';
  END IF;

  v_num_rounds := CAST(round(log(2, v_n)) AS int);

  SELECT COALESCE(MAX(week_number), 0) INTO v_max_week
  FROM public.fixtures
  WHERE competition_id = p_competition_id;

  -- Round 1: both slots filled, 1-vs-N mirror pairing. group_label stays NULL so
  -- self_serve_enter_result routes these through _advance_tournament_winner.
  v_round_num := 1;
  FOR i IN 1..(v_n / 2) LOOP
    INSERT INTO public.fixtures (
      competition_id,
      home_competition_team_id,
      away_competition_team_id,
      week_number,
      round_name,
      status
    ) VALUES (
      p_competition_id,
      v_teams[i],
      v_teams[v_n - i + 1],
      v_max_week + v_round_num,
      v_rnames[LEAST(v_num_rounds - v_round_num + 1, array_length(v_rnames, 1))],
      'scheduled'
    ) RETURNING id INTO v_fx_id;
    v_current_batch := v_current_batch || v_fx_id;
  END LOOP;

  -- Later rounds: empty slots wired to their two feeder fixtures via
  -- knockout_home_feeder_id / knockout_away_feeder_id, status 'allocated'. Filled
  -- by _advance_tournament_winner as each feeder completes. (Verbatim from
  -- venue_seed_knockout 452:1221-1249.)
  v_round_num := 2;
  WHILE array_length(v_current_batch, 1) > 1 LOOP
    v_batch_size := array_length(v_current_batch, 1) / 2;
    v_next_batch := '{}';
    FOR j IN 1..v_batch_size LOOP
      INSERT INTO public.fixtures (
        competition_id,
        home_competition_team_id,
        away_competition_team_id,
        knockout_home_feeder_id,
        knockout_away_feeder_id,
        week_number,
        round_name,
        status
      ) VALUES (
        p_competition_id,
        NULL,
        NULL,
        v_current_batch[2 * j - 1],
        v_current_batch[2 * j],
        v_max_week + v_round_num,
        v_rnames[LEAST(v_num_rounds - v_round_num + 1, array_length(v_rnames, 1))],
        'allocated'
      ) RETURNING id INTO v_fx_id;
      v_next_batch := v_next_batch || v_fx_id;
    END LOOP;
    v_current_batch := v_next_batch;
    v_round_num := v_round_num + 1;
  END LOOP;

  UPDATE public.competitions
  SET config = COALESCE(config, '{}'::jsonb) || '{"knockout_seeded": true}'::jsonb
  WHERE id = p_competition_id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_single_elim_seeded', 'competition', p_competition_id::text,
    jsonb_build_object(
      'tournament_event_id', p_tournament_event_id,
      'total_teams',    v_n,
      'knockout_rounds', v_num_rounds
    )
  );

  RETURN jsonb_build_object(
    'ok',             true,
    'total_teams',    v_n,
    'knockout_rounds', v_num_rounds
  );
END;
$function$;

-- Grants: authenticated-only (self-serve organisers are always signed in). Strip
-- PUBLIC and the auto-granted anon explicitly.
REVOKE ALL ON FUNCTION public.self_serve_seed_single_elim(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_seed_single_elim(text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_seed_single_elim(text, uuid, uuid) TO authenticated;
