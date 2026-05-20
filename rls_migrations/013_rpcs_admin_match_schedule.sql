-- ============================================================
-- Migration 013: Admin match & schedule RPCs
-- Phase B (design only — DO NOT EXECUTE)
-- ============================================================
-- Depends on: 011_rpcs_token_writes.sql (notify_team_change)
--
-- Functions:
--   1. admin_save_match_result   (6-stage, most complex)
--   2. admin_save_teams
--   3. admin_save_bib_holder
--   4. admin_upsert_schedule     (includes OI-22 p_reminders_config)
--   5. admin_upsert_settings
--   6. admin_cancel_match        (8-step cancellation flow)
--
-- Corrections applied:
--   OI-18  matches.cancelled (not is_cancelled); schedule.is_cancelled (not cancelled)
--   OI-19  winner normalised server-side ('D'/'A'/'B')
--   OI-20  bib_history conflict key (team_id, match_date)
--   OI-22  p_reminders_config param on admin_upsert_schedule
--   OI-23  team_assignment written to player_match; drives W/L/D in Stage 5
-- ============================================================


-- ── 1. admin_save_match_result ──────────────────────────────────────────────────
-- §8 idempotency contract: aggregate increments on players (w/l/d/attended/total/
-- goals/motm/owes) are skipped if player_match rows already exist for this match_id.
-- Re-saves update matches and player_match but do NOT double-count player stats.
-- Phase 1 known limitation: if result is corrected (different winner on re-save),
-- player aggregates are not adjusted — deferred to Phase 2 delta correction.

CREATE OR REPLACE FUNCTION admin_save_match_result(
  p_admin_token      text,
  p_match_id         text,       -- null → use schedule.active_match_id
  p_score_type       text,       -- 'exact' | 'margin' | 'declared'
  p_score_a          int,
  p_score_b          int,
  p_winner           text,       -- 'A' | 'B' | 'D' | 'draw' (normalised to 'A'/'B'/'D')
  p_margin           int,
  p_team_a           text[],     -- player IDs on team A
  p_team_b           text[],     -- player IDs on team B
  p_scorers          jsonb,      -- {player_id: goal_count} — used only for 'exact'
  p_motm             text,       -- player ID; null for no MOTM
  p_last_goal_scorer text,
  p_bib_holder       text,       -- player ID; stored on match, full cascade via admin_save_bib_holder
  p_team_switches    jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id           text;
  v_schedule_id       text;
  v_match_id          text;
  v_match_date        date;
  v_price_per_player  int;
  v_winner            text;
  v_existing_pm_count int  := 0;
  v_is_fresh_save     boolean;
  v_pid               text;
BEGIN
  -- ── Stage 1: Validate admin token + resolve match ──────────────────────────
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id, price_per_player INTO v_schedule_id, v_price_per_player
  FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;

  IF p_match_id IS NOT NULL AND p_match_id <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
    END IF;
    v_match_id := p_match_id;
  ELSE
    SELECT active_match_id INTO v_match_id FROM schedule WHERE id = v_schedule_id;
    IF v_match_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_match';
    END IF;
  END IF;

  SELECT match_date INTO v_match_date FROM matches WHERE id = v_match_id;

  -- OI-19: normalise winner — accept 'A'/'B'/'D'/'draw'; store 'A'/'B'/'D'
  v_winner := CASE
    WHEN p_winner IN ('D', 'draw', 'd') THEN 'D'
    WHEN upper(p_winner) = 'A'          THEN 'A'
    WHEN upper(p_winner) = 'B'          THEN 'B'
    ELSE NULL
  END;
  IF v_winner IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_winner';
  END IF;

  -- ── Stage 2: Upsert matches record ─────────────────────────────────────────
  UPDATE matches SET
    score_a          = p_score_a,
    score_b          = p_score_b,
    score_type       = COALESCE(NULLIF(p_score_type, ''), score_type),
    winner           = v_winner,
    team_a           = to_jsonb(p_team_a),
    team_b           = to_jsonb(p_team_b),
    scorers          = COALESCE(p_scorers, scorers),
    last_goal_scorer = p_last_goal_scorer,
    motm             = NULLIF(p_motm, ''),
    bib_holder       = COALESCE(NULLIF(p_bib_holder, ''), bib_holder),
    team_switches    = p_team_switches
  WHERE id = v_match_id AND team_id = v_team_id;

  -- Edge case: match record didn't exist yet (no active game started via UI)
  IF NOT FOUND THEN
    INSERT INTO matches (id, team_id, match_date, score_a, score_b, score_type,
                         winner, team_a, team_b, scorers,
                         last_goal_scorer, motm, bib_holder, team_switches, cancelled, voting_open)
    VALUES (v_match_id, v_team_id, COALESCE(v_match_date, CURRENT_DATE),
            p_score_a, p_score_b,
            COALESCE(NULLIF(p_score_type, ''), 'exact'),
            v_winner, to_jsonb(p_team_a), to_jsonb(p_team_b),
            p_scorers, p_last_goal_scorer, NULLIF(p_motm, ''),
            NULLIF(p_bib_holder, ''), p_team_switches, false, false);
  END IF;

  -- ── Idempotency guard ──────────────────────────────────────────────────────
  -- Aggregate increments on players only fire on the first save.
  -- Re-saves update player_match and matches but skip stat increments.
  SELECT COUNT(*) INTO v_existing_pm_count
  FROM player_match WHERE match_id = v_match_id AND team_id = v_team_id;
  v_is_fresh_save := (v_existing_pm_count = 0);

  -- ── Stage 3: Upsert player_match — team_assignment + result (OI-23) ────────
  FOREACH v_pid IN ARRAY p_team_a LOOP
    INSERT INTO player_match (id, team_id, match_id, player_id, attended,
                              team_assignment, result, goals, had_bibs,
                              was_motm, is_guest, late_cancel, injury_absence)
    VALUES (gen_random_uuid(), v_team_id, v_match_id, v_pid, true,
            'A',
            CASE WHEN v_winner = 'A' THEN 'w'
                 WHEN v_winner = 'B' THEN 'l'
                 ELSE 'd' END,
            0,
            (p_bib_holder IS NOT NULL AND p_bib_holder = v_pid),
            (p_motm IS NOT NULL AND p_motm = v_pid),
            false, false, false)
    ON CONFLICT (match_id, player_id) DO UPDATE SET
      attended        = true,
      team_assignment = 'A',
      result          = CASE WHEN v_winner = 'A' THEN 'w'
                             WHEN v_winner = 'B' THEN 'l'
                             ELSE 'd' END,
      was_motm        = (p_motm IS NOT NULL AND p_motm = v_pid),
      had_bibs        = (p_bib_holder IS NOT NULL AND p_bib_holder = v_pid);
  END LOOP;

  FOREACH v_pid IN ARRAY p_team_b LOOP
    INSERT INTO player_match (id, team_id, match_id, player_id, attended,
                              team_assignment, result, goals, had_bibs,
                              was_motm, is_guest, late_cancel, injury_absence)
    VALUES (gen_random_uuid(), v_team_id, v_match_id, v_pid, true,
            'B',
            CASE WHEN v_winner = 'B' THEN 'w'
                 WHEN v_winner = 'A' THEN 'l'
                 ELSE 'd' END,
            0,
            (p_bib_holder IS NOT NULL AND p_bib_holder = v_pid),
            (p_motm IS NOT NULL AND p_motm = v_pid),
            false, false, false)
    ON CONFLICT (match_id, player_id) DO UPDATE SET
      attended        = true,
      team_assignment = 'B',
      result          = CASE WHEN v_winner = 'B' THEN 'w'
                             WHEN v_winner = 'A' THEN 'l'
                             ELSE 'd' END,
      was_motm        = (p_motm IS NOT NULL AND p_motm = v_pid),
      had_bibs        = (p_bib_holder IS NOT NULL AND p_bib_holder = v_pid);
  END LOOP;

  -- ── Stage 4: Write goals to player_match (exact only) ─────────────────────
  IF p_score_type = 'exact' AND p_scorers IS NOT NULL
     AND jsonb_typeof(p_scorers) = 'object' THEN
    UPDATE player_match pm
      SET goals = (p_scorers ->> pm.player_id)::int
    WHERE pm.match_id  = v_match_id
      AND pm.team_id   = v_team_id
      AND p_scorers ? pm.player_id;
  END IF;

  -- ── Stages 5 & 6: Aggregate player stats — first save only ────────────────
  IF v_is_fresh_save THEN

    -- Stage 5: players.w/l/d driven by team_assignment (OI-23)
    IF v_winner = 'A' THEN
      UPDATE players p SET w = w + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'A' AND pm.attended = true;
      UPDATE players p SET l = l + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'B' AND pm.attended = true;
    ELSIF v_winner = 'B' THEN
      UPDATE players p SET l = l + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'A' AND pm.attended = true;
      UPDATE players p SET w = w + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'B' AND pm.attended = true;
    ELSE
      UPDATE players p SET d = d + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.attended = true;
    END IF;

    -- Stage 6d: owes for unpaid non-guest attendees (OI-59: MUST run BEFORE Stage 6a
    -- resets paid=false; reads pre-reset state to determine who genuinely hasn't paid.
    -- self_paid=true excluded — player intended to pay; charging owes would be incorrect.)
    IF v_price_per_player IS NOT NULL AND v_price_per_player > 0 THEN
      UPDATE players p SET owes = owes + v_price_per_player
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.attended = true
        AND p.paid = false AND p.self_paid = false
        AND p.is_guest = false;
    END IF;

    -- Stage 6a: attended, total, full payment state reset (OI-54: add paid_at, self_paid, paid_by)
    UPDATE players p SET
      attended  = attended + 1,
      total     = total    + 1,
      team      = null,
      status    = 'none',
      paid      = false,
      self_paid = false,
      paid_by   = null,
      paid_at   = null
    FROM player_match pm
    WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
      AND pm.player_id = p.id AND pm.attended = true;

    -- Stage 6b: goals (exact only)
    IF p_score_type = 'exact' AND p_scorers IS NOT NULL
       AND jsonb_typeof(p_scorers) = 'object' THEN
      UPDATE players p SET goals = goals + (p_scorers ->> p.id)::int
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND p_scorers ? p.id;
    END IF;

    -- Stage 6c: MOTM
    IF p_motm IS NOT NULL AND p_motm <> '' THEN
      UPDATE players SET motm = motm + 1 WHERE id = p_motm;
    END IF;

  END IF; -- v_is_fresh_save

  PERFORM notify_team_change(v_team_id, 'match_result_saved');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'match_result_saved', 'match', v_match_id,
          jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b,
                             'winner', v_winner, 'is_fresh_save', v_is_fresh_save));

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id,
                            'is_fresh_save', v_is_fresh_save);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_save_match_result(text,text,text,int,int,text,int,text[],text[],jsonb,text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_save_match_result(text,text,text,int,int,text,int,text[],text[],jsonb,text,text,text) TO authenticated, anon;


-- ── 2. admin_save_teams ─────────────────────────────────────────────────────────
-- Draft (p_confirm=false):  saves to matches.teams_draft for preview.
-- Confirm (p_confirm=true): promotes to matches.team_a/team_b, clears teams_draft.

CREATE OR REPLACE FUNCTION admin_save_teams(
  p_admin_token text,
  p_match_id    text,            -- null → use schedule.active_match_id
  p_team_a      text[],          -- player IDs
  p_team_b      text[],          -- player IDs
  p_confirm     boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id    text;
  v_schedule_id text;
  v_match_id   text;
  v_reason     text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id INTO v_schedule_id FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;

  IF p_match_id IS NOT NULL AND p_match_id <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
    END IF;
    v_match_id := p_match_id;
  ELSE
    SELECT active_match_id INTO v_match_id FROM schedule WHERE id = v_schedule_id;
    IF v_match_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_match';
    END IF;
  END IF;

  IF p_confirm THEN
    -- Confirm: set team_a/team_b, clear teams_draft
    UPDATE matches SET
      team_a      = to_jsonb(p_team_a),
      team_b      = to_jsonb(p_team_b),
      teams_draft = null
    WHERE id = v_match_id AND team_id = v_team_id;
    v_reason := 'match_teams_saved';
  ELSE
    -- Draft: persist draft for preview without committing
    UPDATE matches SET
      teams_draft = jsonb_build_object('a', to_jsonb(p_team_a), 'b', to_jsonb(p_team_b))
    WHERE id = v_match_id AND team_id = v_team_id;
    v_reason := 'match_teams_saved';
  END IF;

  PERFORM notify_team_change(v_team_id, v_reason);

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          v_reason, 'match', v_match_id,
          jsonb_build_object('confirmed', p_confirm,
                             'team_a_count', array_length(p_team_a, 1),
                             'team_b_count', array_length(p_team_b, 1)));

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id, 'confirmed', p_confirm);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_save_teams(text,text,text[],text[],boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_save_teams(text,text,text[],text[],boolean) TO authenticated, anon;


-- ── 3. admin_save_bib_holder ────────────────────────────────────────────────────
-- Full bib cascade:
--   Step 1  Validate admin + player-in-team
--   Step 2  Resolve match_date from matches record
--   Step 3  Resolve player display name (nickname ?? name)
--   Step 4  Close any open bib_history rows for this team (returned=false → true)
--         + Upsert bib_history ON CONFLICT (team_id, match_date) (OI-20)
--         + Update matches.bib_holder = p_player_id (stores player_id; client resolves display)
--         + Increment players.bib_count
--         + Set player_match.had_bibs = true for this player+match
-- Note: Phase 1 limitation — repeated calls increment bib_count each time.

CREATE OR REPLACE FUNCTION admin_save_bib_holder(
  p_admin_token text,
  p_match_id    text,
  p_player_id   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id    text;
  v_match_date date;
  v_bib_name   text;
BEGIN
  -- Step 1: Validate admin + player-in-team
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_not_in_team';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
  END IF;

  -- Step 2: Resolve match_date from matches
  SELECT match_date INTO v_match_date FROM matches WHERE id = p_match_id;
  IF v_match_date IS NULL THEN
    v_match_date := CURRENT_DATE;
  END IF;

  -- Step 3: Resolve display name
  SELECT COALESCE(nickname, name) INTO v_bib_name FROM players WHERE id = p_player_id;
  IF v_bib_name IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_not_found';
  END IF;

  -- Step 4a: Close any open bib_history rows for this team
  UPDATE bib_history SET returned = true
  WHERE team_id = v_team_id AND returned = false;

  -- Step 4b: Upsert bib_history — conflict key (team_id, match_date) (OI-20)
  INSERT INTO bib_history (id, team_id, player_id, name, match_date, returned)
  VALUES ('bib_' || substr(md5(v_team_id || v_match_date::text), 1, 12),
          v_team_id, p_player_id, v_bib_name, v_match_date, false)
  ON CONFLICT (team_id, match_date) DO UPDATE SET
    player_id = EXCLUDED.player_id,
    name      = EXCLUDED.name,
    returned  = false;

  -- Step 4c: Update matches.bib_holder (stores player_id post-migration)
  UPDATE matches SET bib_holder = p_player_id WHERE id = p_match_id AND team_id = v_team_id;

  -- Step 4d: Increment players.bib_count
  UPDATE players SET bib_count = bib_count + 1 WHERE id = p_player_id;

  -- Step 4e: Set had_bibs on player_match for this player+match
  UPDATE player_match SET had_bibs = true
  WHERE match_id = p_match_id AND player_id = p_player_id AND team_id = v_team_id;

  PERFORM notify_team_change(v_team_id, 'match_bibs_saved');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'match_bibs_saved', 'match', p_match_id,
          jsonb_build_object('player_id', p_player_id, 'name', v_bib_name,
                             'match_date', v_match_date));

  RETURN jsonb_build_object('ok', true, 'player_id', p_player_id, 'name', v_bib_name);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_save_bib_holder(text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_save_bib_holder(text,text,text) TO authenticated, anon;


-- ── 4. admin_upsert_schedule ────────────────────────────────────────────────────
-- Updates the active schedule for this team.
-- game_date_time is only updated when p_one_off_date is provided.
-- opens_day defaults to day-before p_day_of_week if p_opens_day is null.
-- OI-22: p_reminders_config included.

CREATE OR REPLACE FUNCTION admin_upsert_schedule(
  p_admin_token       text,
  p_day_of_week       text,
  p_kickoff           text,       -- 'HH:MM'
  p_venue             text,
  p_city              text,
  p_squad_size        int,
  p_price_per_player  int,
  p_bibs_enabled      boolean,
  p_opens_day         text,       -- null → computed as day before p_day_of_week
  p_opens_time        text,
  p_priority_lead_mins int,
  p_reminders_config  jsonb,      -- OI-22
  p_one_off_date      text        -- 'YYYY-MM-DD'; null → keep existing game_date_time
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id     text;
  v_schedule_id text;
  v_opens_day   text;
  v_game_dt     timestamptz;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id INTO v_schedule_id FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;

  -- Compute opens_day = day before p_day_of_week if not supplied
  -- Array is Mon=1..Sun=7; formula: ((pos + 5) % 7) + 1 gives previous day
  v_opens_day := COALESCE(
    NULLIF(p_opens_day, ''),
    (ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[
      ((ARRAY_POSITION(
          ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::text[],
          p_day_of_week::text
        ) + 5) % 7) + 1
    ]
  );

  -- game_date_time: only update if one-off date provided
  -- Known limitation (Phase 1): server is UTC; local kickoff offset not applied
  IF p_one_off_date IS NOT NULL AND p_one_off_date <> '' THEN
    v_game_dt := (p_one_off_date || ' ' || p_kickoff || ':00')::timestamptz;
  ELSE
    SELECT game_date_time INTO v_game_dt FROM schedule WHERE id = v_schedule_id;
  END IF;

  UPDATE schedule SET
    day_of_week        = p_day_of_week,
    kickoff            = p_kickoff,
    venue              = p_venue,
    city               = p_city,
    squad_size         = p_squad_size,
    price_per_player   = p_price_per_player,
    bibs_enabled       = p_bibs_enabled,
    opens_day          = v_opens_day,
    opens_time         = p_opens_time,
    priority_lead_mins = p_priority_lead_mins,
    reminders_config   = p_reminders_config,
    game_date_time     = v_game_dt
  WHERE id = v_schedule_id AND team_id = v_team_id;

  PERFORM notify_team_change(v_team_id, 'schedule_updated');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'schedule_updated', 'schedule', v_schedule_id,
          jsonb_build_object('day_of_week', p_day_of_week, 'kickoff', p_kickoff,
                             'venue', p_venue, 'squad_size', p_squad_size));

  RETURN jsonb_build_object('ok', true, 'schedule_id', v_schedule_id);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_upsert_schedule(text,text,text,text,text,int,int,boolean,text,text,int,jsonb,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_upsert_schedule(text,text,text,text,text,int,int,boolean,text,text,int,jsonb,text) TO authenticated, anon;


-- ── 5. admin_upsert_settings ────────────────────────────────────────────────────
-- Saves group_name to the settings table.
-- settings row is always created during onboarding; UPDATE is the normal path.
-- Fallback INSERT handles edge case where onboarding left no row.

CREATE OR REPLACE FUNCTION admin_upsert_settings(
  p_admin_token text,
  p_group_name  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id   text;
  v_settings_id text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF p_group_name IS NULL OR trim(p_group_name) = '' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='group_name_required';
  END IF;

  UPDATE settings SET group_name = trim(p_group_name) WHERE team_id = v_team_id;

  -- Fallback: create settings row if onboarding left none
  IF NOT FOUND THEN
    v_settings_id := 'sett_' || v_team_id;
    INSERT INTO settings (id, team_id, group_name)
    VALUES (v_settings_id, v_team_id, trim(p_group_name))
    ON CONFLICT (team_id) DO UPDATE SET group_name = EXCLUDED.group_name;
  END IF;

  -- 'settings_updated' — OI-51: add to §11.2 locked list before Phase C
  PERFORM notify_team_change(v_team_id, 'settings_updated');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'settings_updated', 'settings', v_team_id,
          jsonb_build_object('group_name', trim(p_group_name)));

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_upsert_settings(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_upsert_settings(text,text) TO authenticated, anon;


-- ── 6. admin_cancel_match ───────────────────────────────────────────────────────
-- 8-step cancellation flow (consolidates JS bulkCancelLedgerEntries +
-- deletePlayerMatchRows + bulkResetPlayerStatuses into one transaction).
--
-- Steps:
--   1  Validate admin token
--   2  Get active schedule + active_match_id (nullable)
--   3  Collect IN players for payment processing
--   4  Process payment ledger (refunds + cancelled audit entries)
--   5  Bulk reset player statuses: status='none', paid=false, self_paid=false
--   6  Delete player_match rows for this match
--   7  Update matches.cancelled = true, cancel_reason (OI-18: `cancelled` not `is_cancelled`)
--   8  Update schedule: is_cancelled=true, game_is_live=false, cancel_reason (OI-18)
--
-- payment_ledger type='cancelled' and status='cancelled' require CHECK constraint
-- updates (documented in supabase.js bulkCancelLedgerEntries comment); flagged OI-52.

CREATE OR REPLACE FUNCTION admin_cancel_match(
  p_admin_token   text,
  p_cancel_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id     text;
  v_schedule_id text;
  v_match_id    text;
BEGIN
  -- Step 1: Validate admin token
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  -- Step 2: Get active schedule + active_match_id
  SELECT id, active_match_id INTO v_schedule_id, v_match_id
  FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;
  -- v_match_id may be NULL (game not yet started — cancel the schedule day only)

  -- Steps 3 & 4: Payment ledger processing (only when a match record exists)
  IF v_match_id IS NOT NULL THEN

    -- Step 4a: Refund entries for already-paid players
    INSERT INTO payment_ledger (team_id, player_id, match_id,
                                amount, type, status, method, paid_by, paid_at, note)
    SELECT v_team_id, pl.player_id, v_match_id,
           pl.amount, 'refund', 'refunded', 'admin', 'admin', now(), 'Match cancelled'
    FROM payment_ledger pl
    WHERE pl.match_id = v_match_id
      AND pl.team_id  = v_team_id
      AND pl.type     = 'game_fee'
      AND pl.status   = 'paid';

    -- Clear payment flags for those players
    UPDATE players p SET paid = false, self_paid = false, paid_by = null, paid_at = null
    FROM payment_ledger pl
    WHERE pl.match_id = v_match_id AND pl.team_id = v_team_id
      AND pl.type = 'game_fee' AND pl.status = 'paid'
      AND pl.player_id = p.id;

    -- Step 4b: Refund entries for self-paid-pending (unpaid + self_paid=true)
    INSERT INTO payment_ledger (team_id, player_id, match_id,
                                amount, type, status, method, paid_by, paid_at, note)
    SELECT v_team_id, pl.player_id, v_match_id,
           pl.amount, 'refund', 'refunded', 'admin', 'admin', now(), 'Match cancelled'
    FROM payment_ledger pl
    JOIN players p ON p.id = pl.player_id
    WHERE pl.match_id = v_match_id AND pl.team_id = v_team_id
      AND pl.type = 'game_fee' AND pl.status = 'unpaid'
      AND p.self_paid = true;

    UPDATE players p SET self_paid = false, paid_by = null, paid_at = null
    FROM payment_ledger pl
    WHERE pl.match_id = v_match_id AND pl.team_id = v_team_id
      AND pl.type = 'game_fee' AND pl.status = 'unpaid'
      AND pl.player_id = p.id AND p.self_paid = true;

    -- Step 4c: Cancelled audit entries for all IN players (OI-52: needs CHECK update)
    INSERT INTO payment_ledger (team_id, player_id, match_id, amount, type, status, note)
    SELECT v_team_id, tp.player_id, v_match_id, 0, 'cancelled', 'cancelled', 'Match cancelled'
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = v_team_id AND p.status = 'in';

    -- Step 6: Delete player_match rows for this match
    DELETE FROM player_match WHERE match_id = v_match_id AND team_id = v_team_id;

    -- Step 7: Mark match as cancelled (OI-18: matches uses `cancelled`, not `is_cancelled`)
    UPDATE matches SET
      cancelled     = true,
      cancel_reason = p_cancel_reason
    WHERE id = v_match_id AND team_id = v_team_id;

  END IF;

  -- Step 5: Bulk reset player statuses for this team
  UPDATE players p SET
    status    = 'none',
    paid      = false,
    self_paid = false,
    paid_by   = null
  FROM team_players tp
  WHERE tp.team_id = v_team_id
    AND tp.player_id = p.id
    AND p.disabled = false;

  -- Step 8: schedule — is_cancelled, game over, reset auto-open for next week (OI-18, OI-61)
  UPDATE schedule SET
    is_cancelled      = true,
    cancel_reason     = p_cancel_reason,
    game_is_live      = false,
    active_match_id   = null,
    auto_open_pending = true    -- OI-61: reset so advanceGameDateJob auto-opens next week
  WHERE id = v_schedule_id AND team_id = v_team_id;

  PERFORM notify_team_change(v_team_id, 'match_cancelled');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'match_cancelled', 'match', COALESCE(v_match_id, v_schedule_id),
          jsonb_build_object('cancel_reason', p_cancel_reason,
                             'had_active_match', v_match_id IS NOT NULL));

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_cancel_match(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_cancel_match(text,text) TO authenticated, anon;