-- 187_phase11_cup_advancement.sql
-- LEAGUE MODE — Phase 11 Cycle 11.2: the bracket comes alive.
--
-- Adds the advancement engine + the knockout decider + next-round scheduling:
--   * _cup_advance(competition_id)      — idempotent sweep: resolve decided ties from
--       terminal fixtures, propagate each winner into its parent slot (via the feeder
--       edges from 11.1), mark pending ties whose both sides are now known as 'ready'.
--   * tg_cup_advance / trigger          — runs the sweep after ANY cup fixture reaches a
--       terminal state (completed / walkover / forfeit). Only touches cup_ties, so no
--       fixtures recursion.
--   * ref_record_knockout_decider(...)  — when a knockout is level at full time, the ref
--       enters extra-time and/or penalties (typed) + the winner; completes the fixture.
--   * ref_confirm_full_time (REPLACE)   — for a level cup knockout it no longer completes;
--       it returns {needs_decider:true} and leaves the fixture in_progress. Decisive ties
--       complete + stamp decided_by; league fixtures unchanged.
--   * venue_schedule_cup_tie(...)       — operator schedules a 'ready' next-round tie:
--       creates the fixture (linked) + fee charge, flips the tie to 'scheduled'.
--
-- "Operator schedules each round" (session 65): advancement never invents a date — it
-- marks the tie 'ready' and the venue picks date/time/pitch.
--
-- Note on byes: round-1 byes are created 'decided' (mig 185). The first time ANY round-1
-- fixture completes, the trigger runs the full-competition sweep, which propagates every
-- decided bye into its parent — so a round-2 tie fed by two byes becomes 'ready' then.
-- (No creation-time advance, to avoid re-declaring the large persist function here.)

-- ── Advancement sweep ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cup_advance(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tie record;
  v_win text;
BEGIN
  -- 1. Resolve winners for ties whose fixture is terminal but tie not yet decided.
  FOR v_tie IN
    SELECT ct.id, ct.home_team_id, ct.away_team_id,
           f.status AS fx_status, f.home_score, f.away_score,
           f.ko_winner_id, f.walkover_winner_id, f.forfeit_winner_id
    FROM cup_ties ct
    JOIN fixtures f ON f.id = ct.fixture_id
    WHERE ct.competition_id = p_competition_id
      AND ct.status <> 'decided'
      AND f.status IN ('completed','walkover','forfeit')
  LOOP
    v_win := CASE
      WHEN v_tie.fx_status = 'walkover' THEN v_tie.walkover_winner_id
      WHEN v_tie.fx_status = 'forfeit'  THEN v_tie.forfeit_winner_id
      WHEN v_tie.ko_winner_id IS NOT NULL THEN v_tie.ko_winner_id
      WHEN v_tie.home_score > v_tie.away_score THEN v_tie.home_team_id
      WHEN v_tie.away_score > v_tie.home_score THEN v_tie.away_team_id
      ELSE NULL
    END;
    IF v_win IS NOT NULL THEN
      UPDATE cup_ties SET winner_team_id = v_win, status = 'decided' WHERE id = v_tie.id;
    END IF;
  END LOOP;

  -- 2. Propagate every decided winner into its parent slot (feeder edges from 11.1).
  FOR v_tie IN
    SELECT round_number, slot_index, winner_team_id
    FROM cup_ties
    WHERE competition_id = p_competition_id AND status = 'decided' AND winner_team_id IS NOT NULL
  LOOP
    UPDATE cup_ties p
       SET home_team_id = v_tie.winner_team_id
     WHERE p.competition_id = p_competition_id
       AND p.round_number = v_tie.round_number + 1
       AND p.home_feeder_slot = v_tie.slot_index
       AND p.fixture_id IS NULL
       AND p.home_team_id IS DISTINCT FROM v_tie.winner_team_id;
    UPDATE cup_ties p
       SET away_team_id = v_tie.winner_team_id
     WHERE p.competition_id = p_competition_id
       AND p.round_number = v_tie.round_number + 1
       AND p.away_feeder_slot = v_tie.slot_index
       AND p.fixture_id IS NULL
       AND p.away_team_id IS DISTINCT FROM v_tie.winner_team_id;
  END LOOP;

  -- 3. Pending ties whose both sides are now known → 'ready' (awaiting scheduling).
  UPDATE cup_ties
     SET status = 'ready'
   WHERE competition_id = p_competition_id
     AND status = 'pending'
     AND home_team_id IS NOT NULL
     AND away_team_id IS NOT NULL
     AND fixture_id IS NULL;
END;
$function$;

-- ── Trigger: advance after a cup fixture reaches a terminal state ─────────────
CREATE OR REPLACE FUNCTION public.tg_cup_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.cup_tie_id IS NOT NULL AND NEW.status IN ('completed','walkover','forfeit') THEN
    PERFORM public._cup_advance(NEW.competition_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cup_advance_after_result ON public.fixtures;
CREATE TRIGGER cup_advance_after_result
AFTER UPDATE OF status, home_score, away_score, ko_winner_id, walkover_winner_id, forfeit_winner_id
ON public.fixtures
FOR EACH ROW
WHEN (NEW.cup_tie_id IS NOT NULL)
EXECUTE FUNCTION public.tg_cup_advance();

-- ── Ref: knockout decider (level → ET and/or penalties) ──────────────────────
CREATE OR REPLACE FUNCTION public.ref_record_knockout_decider(
  p_ref_token text, p_aet_home int, p_aet_away int,
  p_pens_home int, p_pens_away int, p_winner_team_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_type    text;
  v_home    int;
  v_away    int;
  v_decided text;
  v_venue_id text;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.cup_tie_id IS NULL THEN
    RAISE EXCEPTION 'not_a_cup_tie' USING ERRCODE='P0001';
  END IF;
  SELECT type INTO v_type FROM competitions WHERE id = v_fixture.competition_id;
  IF v_type <> 'cup' THEN
    RAISE EXCEPTION 'not_a_cup_tie' USING ERRCODE='P0001';
  END IF;
  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE event_type='goal'     AND team_id = v_fixture.home_team_id)
   +COUNT(*) FILTER (WHERE event_type='own_goal' AND team_id = v_fixture.away_team_id),
    COUNT(*) FILTER (WHERE event_type='goal'     AND team_id = v_fixture.away_team_id)
   +COUNT(*) FILTER (WHERE event_type='own_goal' AND team_id = v_fixture.home_team_id)
  INTO v_home, v_away FROM public.match_events WHERE fixture_id = v_fixture.id;

  IF v_home <> v_away THEN
    RAISE EXCEPTION 'not_level_use_full_time' USING ERRCODE='P0001';
  END IF;

  IF p_winner_team_id IS NULL
     OR (p_winner_team_id <> v_fixture.home_team_id
         AND (v_fixture.away_team_id IS NULL OR p_winner_team_id <> v_fixture.away_team_id)) THEN
    RAISE EXCEPTION 'winner_not_in_fixture' USING ERRCODE='P0001';
  END IF;

  -- Penalties take precedence (they only happen when ET is level / skipped).
  IF p_pens_home IS NOT NULL AND p_pens_away IS NOT NULL THEN
    IF p_pens_home < 0 OR p_pens_away < 0 THEN RAISE EXCEPTION 'pens_invalid' USING ERRCODE='P0001'; END IF;
    IF p_pens_home = p_pens_away THEN RAISE EXCEPTION 'pens_cannot_be_level' USING ERRCODE='P0001'; END IF;
    IF (p_pens_home > p_pens_away AND p_winner_team_id <> v_fixture.home_team_id)
       OR (p_pens_away > p_pens_home AND p_winner_team_id <> v_fixture.away_team_id) THEN
      RAISE EXCEPTION 'winner_pens_mismatch' USING ERRCODE='P0001';
    END IF;
    v_decided := 'penalties';
  ELSIF p_aet_home IS NOT NULL AND p_aet_away IS NOT NULL THEN
    IF p_aet_home < 0 OR p_aet_away < 0 THEN RAISE EXCEPTION 'aet_invalid' USING ERRCODE='P0001'; END IF;
    IF p_aet_home = p_aet_away THEN RAISE EXCEPTION 'extra_time_level_needs_pens' USING ERRCODE='P0001'; END IF;
    IF (p_aet_home > p_aet_away AND p_winner_team_id <> v_fixture.home_team_id)
       OR (p_aet_away > p_aet_home AND p_winner_team_id <> v_fixture.away_team_id) THEN
      RAISE EXCEPTION 'winner_aet_mismatch' USING ERRCODE='P0001';
    END IF;
    v_decided := 'extra_time';
  ELSE
    RAISE EXCEPTION 'decider_required' USING ERRCODE='P0001';
  END IF;

  UPDATE fixtures SET status='completed', home_score=v_home, away_score=v_away,
    aet_home_score=p_aet_home, aet_away_score=p_aet_away,
    pens_home_score=p_pens_home, pens_away_score=p_pens_away,
    ko_winner_id=p_winner_team_id, decided_by=v_decided
  WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_fixture.home_team_id, 'referee', p_ref_token, 'ref_knockout_decider', 'fixture', v_fixture.id::text,
    jsonb_build_object('home_score',v_home,'away_score',v_away,'aet_home',p_aet_home,'aet_away',p_aet_away,
      'pens_home',p_pens_home,'pens_away',p_pens_away,'decided_by',v_decided,'winner_team_id',p_winner_team_id));

  PERFORM public.notify_team_change(v_fixture.home_team_id,'match_result_saved');
  IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_result_saved'); END IF;
  v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_result_saved'); END IF;

  RETURN jsonb_build_object('ok',true,'fixture_id',v_fixture.id,'status','completed',
    'home_score',v_home,'away_score',v_away,'decided_by',v_decided,'winner_team_id',p_winner_team_id);
END;
$function$;

-- ── Ref: full-time confirm (REPLACE — cup-level → needs decider) ──────────────
CREATE OR REPLACE FUNCTION public.ref_confirm_full_time(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_home int; v_away int; v_venue_id text;
  v_is_cup boolean; v_decided text;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status;
  END IF;
  SELECT
    COUNT(*) FILTER (WHERE event_type='goal' AND team_id = v_fixture.home_team_id)
   +COUNT(*) FILTER (WHERE event_type='own_goal' AND team_id = v_fixture.away_team_id),
    COUNT(*) FILTER (WHERE event_type='goal' AND team_id = v_fixture.away_team_id)
   +COUNT(*) FILTER (WHERE event_type='own_goal' AND team_id = v_fixture.home_team_id)
  INTO v_home, v_away FROM public.match_events WHERE fixture_id = v_fixture.id;

  v_is_cup := v_fixture.cup_tie_id IS NOT NULL;

  -- A level knockout can't finish here — hand back to the decider flow.
  IF v_is_cup AND v_home = v_away THEN
    RETURN jsonb_build_object('ok', true, 'needs_decider', true,
      'fixture_id', v_fixture.id, 'home_score', v_home, 'away_score', v_away, 'status', 'in_progress');
  END IF;

  v_decided := CASE WHEN v_is_cup THEN 'regulation' ELSE NULL END;

  UPDATE public.fixtures
     SET status='completed', home_score = v_home, away_score = v_away, decided_by = v_decided
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
  VALUES (v_fixture.home_team_id,'referee',p_ref_token,'ref_confirm_full_time','fixture',v_fixture.id::text,
    jsonb_build_object('home_team_id',v_fixture.home_team_id,'away_team_id',v_fixture.away_team_id,'home_score',v_home,'away_score',v_away));
  PERFORM public.notify_team_change(v_fixture.home_team_id,'match_result_saved');
  IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_result_saved'); END IF;
  v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_result_saved'); END IF;
  RETURN jsonb_build_object('ok',true,'fixture_id',v_fixture.id,'home_score',v_home,'away_score',v_away,'status','completed');
END;
$function$;

-- ── Venue: schedule a 'ready' next-round tie ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_schedule_cup_tie(
  p_venue_token text, p_tie_id uuid, p_scheduled_date date, p_kickoff_time time, p_playing_area_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_tie record;
  v_league_id text;
  v_fixture_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_tie_id IS NULL THEN RAISE EXCEPTION 'tie_id_required' USING ERRCODE='P0001'; END IF;
  IF p_scheduled_date IS NULL OR p_kickoff_time IS NULL THEN
    RAISE EXCEPTION 'schedule_required' USING ERRCODE='P0001';
  END IF;

  SELECT ct.id, ct.competition_id, ct.round_number, ct.round_name, ct.slot_index,
         ct.home_team_id, ct.away_team_id, ct.status, ct.fixture_id,
         s.league_id, s.start_date, s.end_date, l.venue_id AS l_venue
  INTO v_tie
  FROM cup_ties ct
  JOIN competitions c ON c.id = ct.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE ct.id = p_tie_id;

  IF v_tie.id IS NULL THEN RAISE EXCEPTION 'tie_not_found' USING ERRCODE='P0001'; END IF;
  IF v_tie.l_venue <> v_venue_id THEN RAISE EXCEPTION 'tie_not_in_venue' USING ERRCODE='P0001'; END IF;
  IF v_tie.fixture_id IS NOT NULL THEN RAISE EXCEPTION 'tie_already_scheduled' USING ERRCODE='P0001'; END IF;
  IF v_tie.status <> 'ready' OR v_tie.home_team_id IS NULL OR v_tie.away_team_id IS NULL THEN
    RAISE EXCEPTION 'tie_not_ready' USING ERRCODE='P0001', DETAIL = COALESCE(v_tie.status,'null');
  END IF;
  IF p_scheduled_date < v_tie.start_date OR p_scheduled_date > v_tie.end_date THEN
    RAISE EXCEPTION 'date_outside_season' USING ERRCODE='P0001', DETAIL = p_scheduled_date::text;
  END IF;
  v_league_id := v_tie.league_id;

  IF p_playing_area_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE='P0001';
  END IF;

  INSERT INTO fixtures (competition_id, home_team_id, away_team_id, week_number, round_name,
                        scheduled_date, kickoff_time, playing_area_id, status, cup_tie_id)
  VALUES (v_tie.competition_id, v_tie.home_team_id, v_tie.away_team_id, v_tie.round_number,
          v_tie.round_name, p_scheduled_date, p_kickoff_time, p_playing_area_id, 'scheduled', v_tie.id)
  RETURNING id INTO v_fixture_id;

  UPDATE cup_ties SET fixture_id = v_fixture_id, status = 'scheduled' WHERE id = v_tie.id;

  INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  SELECT v_venue_id, 'fixture', v_fixture_id::text, tm.team_id, v_tie.competition_id,
         lc.fixture_fee_pence, 'unpaid', p_scheduled_date
  FROM league_config lc
  CROSS JOIN LATERAL (
    SELECT v_tie.home_team_id AS team_id
    UNION ALL
    SELECT v_tie.away_team_id WHERE COALESCE(lc.fixture_fee_payer, 'both') = 'both'
  ) tm
  WHERE lc.league_id = v_league_id
    AND tm.team_id IS NOT NULL
    AND COALESCE(lc.fixture_fee_pence, 0) > 0
  ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'cup_tie_scheduled', 'fixture', v_fixture_id::text,
          jsonb_build_object('competition_id', v_tie.competition_id, 'league_id', v_league_id,
            'tie_id', v_tie.id, 'round_number', v_tie.round_number));

  PERFORM public.notify_venue_change(v_venue_id, 'cup_tie_scheduled');
  PERFORM public.notify_league_change(v_league_id, 'cup_tie_scheduled');

  RETURN jsonb_build_object('ok', true, 'tie_id', v_tie.id, 'fixture_id', v_fixture_id,
    'round_number', v_tie.round_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_record_knockout_decider(text, int, int, int, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ref_record_knockout_decider(text, int, int, int, int, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_schedule_cup_tie(text, uuid, date, time, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_schedule_cup_tie(text, uuid, date, time, uuid) TO anon, authenticated;

-- Internal helpers — not client-callable (the trigger runs _cup_advance as definer).
REVOKE ALL ON FUNCTION public._cup_advance(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_cup_advance() FROM public, anon, authenticated;
