-- 206: admin_save_match_result also clears admin_locked_in on fresh save.
--
-- Gap found in the session-68 audit: the fresh-save reset cleared status='none'
-- but left admin_locked_in=true. go-live (mig 204) clears admin_locked_in, but
-- ONLY when a new match is created — the idempotent reuse path (double-tap) skips
-- it. So an admin-force-in player could remain locked across weeks and be unable
-- to self-set 'in'. Clearing it at result finalisation closes the gap regardless
-- of which go-live path runs next.
--
-- Only change vs mig 205: `admin_locked_in = false` added to the fresh-save reset
-- UPDATE. Full body re-applied for a single source of truth.

CREATE OR REPLACE FUNCTION public.admin_save_match_result(p_admin_token text, p_match_id text, p_score_type text, p_score_a integer, p_score_b integer, p_winner text, p_margin integer, p_team_a text[], p_team_b text[], p_scorers jsonb, p_motm text, p_last_goal_scorer text, p_bib_holder text, p_team_switches jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id           text;
  v_schedule_id       text;
  v_match_id          text;
  v_match_date        date;
  v_price_per_player  int;
  v_winner            text;
  v_prev_winner       text;
  v_is_fresh_save     boolean;
  v_pid               text;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
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

  -- Capture match_date and the PRIOR winner before we overwrite it. winner is
  -- NULL until the first finalisation, so it is the freshness signal below.
  SELECT match_date, winner INTO v_match_date, v_prev_winner FROM matches WHERE id = v_match_id;

  v_winner := CASE
    WHEN p_winner IN ('D', 'draw', 'd') THEN 'D'
    WHEN upper(p_winner) = 'A'          THEN 'A'
    WHEN upper(p_winner) = 'B'          THEN 'B'
    ELSE NULL
  END;
  IF v_winner IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_winner';
  END IF;

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

  IF NOT FOUND THEN
    INSERT INTO matches (id, team_id, match_date, score_a, score_b, score_type,
                         winner, team_a, team_b, scorers, last_goal_scorer,
                         motm, bib_holder, cancelled, voting_open, team_switches)
    VALUES (v_match_id, v_team_id, COALESCE(v_match_date, CURRENT_DATE),
            p_score_a, p_score_b,
            COALESCE(NULLIF(p_score_type, ''), 'exact'),
            v_winner, to_jsonb(p_team_a), to_jsonb(p_team_b),
            p_scorers, p_last_goal_scorer, NULLIF(p_motm, ''),
            NULLIF(p_bib_holder, ''), false, false, p_team_switches);
  END IF;

  -- Freshness: has this match been finalised before? winner was NULL until the
  -- first result save (the kickoff lineup-lock writes player_match but not winner).
  v_is_fresh_save := (v_prev_winner IS NULL);

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

  IF p_score_type = 'exact' AND p_scorers IS NOT NULL
     AND jsonb_typeof(p_scorers) = 'object' THEN
    UPDATE player_match pm
      SET goals = (p_scorers ->> pm.player_id)::int
    WHERE pm.match_id  = v_match_id
      AND pm.team_id   = v_team_id
      AND p_scorers ? pm.player_id;
  END IF;

  IF v_is_fresh_save THEN

    IF v_winner = 'A' THEN
      UPDATE players p SET w = p.w + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'A' AND pm.attended = true;
      UPDATE players p SET l = p.l + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'B' AND pm.attended = true;
    ELSIF v_winner = 'B' THEN
      UPDATE players p SET l = p.l + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'A' AND pm.attended = true;
      UPDATE players p SET w = p.w + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'B' AND pm.attended = true;
    ELSE
      UPDATE players p SET d = p.d + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.attended = true;
    END IF;

    -- owes for unpaid non-guest attendees. MUST run before the reset below.
    IF v_price_per_player IS NOT NULL AND v_price_per_player > 0 THEN
      UPDATE players p SET owes = p.owes + v_price_per_player
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.attended = true
        AND p.paid = false AND p.self_paid = false
        AND p.is_guest = false;

      INSERT INTO payment_ledger
        (id, team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at)
      SELECT gen_random_uuid(), v_team_id, p.id, v_match_id,
             v_price_per_player, 'game_fee', 'unpaid', NULL, NULL, NULL
      FROM players p
      JOIN player_match pm ON pm.player_id = p.id
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.attended = true
        AND p.paid = false AND p.self_paid = false AND p.is_guest = false
        AND NOT EXISTS (
          SELECT 1 FROM payment_ledger l
          WHERE l.player_id = p.id AND l.team_id = v_team_id
            AND l.match_id = v_match_id AND l.type = 'game_fee'
        );
    END IF;

    -- New-week reset for everyone who played. admin_locked_in cleared here too
    -- (mig 206) so the force-in lock never persists past the finalised match.
    UPDATE players p SET
      attended        = p.attended + 1,
      total           = p.total    + 1,
      team            = null,
      status          = 'none',
      admin_locked_in = false,
      paid            = false,
      self_paid       = false,
      paid_by         = null,
      paid_at         = null
    FROM player_match pm
    WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
      AND pm.player_id = p.id AND pm.attended = true;

    IF p_score_type = 'exact' AND p_scorers IS NOT NULL
       AND jsonb_typeof(p_scorers) = 'object' THEN
      UPDATE players p SET goals = p.goals + (p_scorers ->> p.id)::int
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND p_scorers ? p.id;
    END IF;

    IF p_motm IS NOT NULL AND p_motm <> '' THEN
      UPDATE players SET motm = motm + 1 WHERE id = p_motm;
    END IF;

    IF NULLIF(p_bib_holder, '') IS NOT NULL THEN
      UPDATE bib_history SET returned = true
        WHERE team_id = v_team_id AND returned = false;
      INSERT INTO bib_history (team_id, player_id, name, match_date, returned)
      VALUES (v_team_id, p_bib_holder,
              (SELECT name FROM players WHERE id = p_bib_holder),
              COALESCE(v_match_date, CURRENT_DATE), false)
      ON CONFLICT (team_id, match_date) DO UPDATE SET
        player_id = EXCLUDED.player_id, name = EXCLUDED.name, returned = false;
      UPDATE players SET bib_count = bib_count + 1 WHERE id = p_bib_holder;
    END IF;

  END IF;

  PERFORM notify_team_change(v_team_id, 'match_result_saved');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
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
$function$;

SELECT pg_notify('pgrst', 'reload schema');
