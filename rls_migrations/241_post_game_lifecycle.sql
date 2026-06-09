-- 241: post-game lifecycle hardening (session 80)
--
-- Three defects surfaced live on Footy Tuesdays the night a game finished:
--   A. The played game never closed — admin_save_match_result never touched
--      schedule.game_is_live, so the client kept showing In/Out buttons and
--      players signed IN to a match that had already been played.
--   B. set_player_status had NO server-side gate — the ONLY thing stopping a
--      sign-up was the client hiding the button (stale client / direct call
--      sailed through). Violates "never trust the client".
--   C. The result-save reset only touched ATTENDEES (WHERE pm.attended=true),
--      so reserves/maybes kept their status after the game; and it wiped the
--      flat `paid` flag of players already confirmed paid for that same match,
--      diverging My View from the ledger.
--
-- Fixes:
--   • admin_save_match_result: close the game (game_is_live=false); reset EVERY
--     remaining squad status (reserves included), not just attendees; preserve
--     paid=true for players whose game_fee ledger for this match is already
--     'paid' (go-live resets status but NOT paid/owes, and next week's save keys
--     on next week's match_id, so this does not carry a stale paid forward).
--   • set_player_status: refuse any status change unless the active schedule is
--     game_is_live=true AND NOT is_cancelled (new error 'game_not_live').
--
-- Both are SECURITY DEFINER; CREATE OR REPLACE preserves existing grants.

-- ── set_player_status: server-side sign-up window gate ───────────────────────
CREATE OR REPLACE FUNCTION public.set_player_status(p_token text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id    text;
  v_team_id      text;
  v_prev_status  text;
  v_cap          int;
  v_in_count     int;
  v_locked       boolean;
  v_game_live    boolean;
  v_cancelled    boolean;
  v_result       jsonb;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('in','out','maybe','reserve','none') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status';
  END IF;

  -- Sign-up window gate (mig 241): the casual sign-up window is only open while
  -- the game is live and not cancelled. The client hides the In/Out buttons when
  -- game_is_live=false, but a stale client or a direct RPC call must not slip a
  -- status change through. Applies to EVERY status value — once a game is closed
  -- (or before it opens) no self-status change is permitted until the next
  -- go-live flips game_is_live back to true.
  SELECT s.game_is_live, COALESCE(s.is_cancelled, false)
    INTO v_game_live, v_cancelled
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  IF v_game_live IS DISTINCT FROM true OR v_cancelled = true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'game_not_live';
  END IF;

  -- Lock guard: refuse self-restore to 'in' while admin-locked
  IF p_status = 'in' THEN
    SELECT admin_locked_in INTO v_locked FROM players WHERE id = v_player_id;
    IF v_locked = true THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'admin_locked_in';
    END IF;

    -- Cap guard: refuse if team at squad_size (defence-in-depth)
    SELECT s.squad_size INTO v_cap
      FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

    SELECT COUNT(*) INTO v_in_count
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
      WHERE tp.team_id = v_team_id
        AND p.status = 'in' AND NOT p.disabled
        AND p.id <> v_player_id;

    IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'squad_full';
    END IF;
  END IF;

  -- Capture previous status for audit metadata
  SELECT status INTO v_prev_status FROM players WHERE id = v_player_id;

  UPDATE players
  SET    status = p_status
  WHERE  id     = v_player_id;

  -- NEW (060): audit every self-status write so silent client-side failures
  -- become diagnosable. actor_user_id will be null for anon callers — that
  -- itself is diagnostic (caller had no auth session at tap time).
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_status_set', 'player', v_player_id,
    jsonb_build_object(
      'status',          p_status,
      'previous_status', v_prev_status
    )
  );

  SELECT jsonb_build_object(
    'id',             p.id,
    'name',           p.name,
    'nickname',       p.nickname,
    'status',         p.status,
    'type',           p.type,
    'priority',       p.priority,
    'paid',           p.paid,
    'owes',           p.owes,
    'self_paid',      p.self_paid,
    'paid_by',        p.paid_by,
    'pay_count',      p.pay_count,
    'goals',          p.goals,
    'motm',           p.motm,
    'attended',       p.attended,
    'total',          p.total,
    'w',              p.w,
    'l',              p.l,
    'd',              p.d,
    'bib_count',      p.bib_count,
    'late_dropouts',  p.late_dropouts,
    'injured',        p.injured,
    'injured_since',  p.injured_since,
    'is_guest',       p.is_guest,
    'guest_of',       p.guest_of,
    'note',           p.note,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p
  WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_status_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

-- ── admin_save_match_result: close game + reset all statuses + keep paid ─────
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

    -- Attendee reset + stats bump. paid is preserved (not wiped) for any player
    -- whose game_fee ledger row for THIS match is already 'paid' — otherwise
    -- the wipe diverged My View (flat paid=false) from the ledger (mig 241).
    -- self_paid is cleared (a stale claim is meaningless once the game is over);
    -- next week's save keys on next week's match_id so this never carries a
    -- stale paid forward.
    UPDATE players p SET
      attended        = p.attended + 1,
      total           = p.total    + 1,
      team            = null,
      status          = 'none',
      admin_locked_in = false,
      paid            = (l_paid.id IS NOT NULL),
      self_paid       = false,
      paid_by         = CASE WHEN l_paid.id IS NOT NULL THEN COALESCE(p.paid_by, 'admin') ELSE null END,
      paid_at         = CASE WHEN l_paid.id IS NOT NULL THEN COALESCE(p.paid_at, now()) ELSE null END
    FROM player_match pm
    LEFT JOIN payment_ledger l_paid
      ON l_paid.player_id = pm.player_id AND l_paid.team_id = v_team_id
     AND l_paid.match_id = v_match_id AND l_paid.type = 'game_fee'
     AND l_paid.status = 'paid'
    WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
      AND pm.player_id = p.id AND pm.attended = true;

    -- Close the game: the played match stops accepting sign-ups. game_is_live
    -- gates both the client buttons AND set_player_status (mig 241).
    UPDATE schedule SET game_is_live = false WHERE id = v_schedule_id;

    -- Reset EVERY remaining squad status — reserves, maybes, no-shows — not just
    -- the attendees reset above. A completed game must leave no lingering status.
    UPDATE players p SET status = 'none', team = null
    FROM team_players tp
    WHERE tp.player_id = p.id AND tp.team_id = v_team_id
      AND p.status <> 'none';

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
