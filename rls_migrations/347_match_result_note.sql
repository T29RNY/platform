-- ════════════════════════════════════════════════════════════════════════════
-- 347 — Match result note
-- ════════════════════════════════════════════════════════════════════════════
-- Admins can attach a free-text note to a match RESULT (distinct from
-- cancel_reason, which is cancellation-only) — e.g. "abandoned early due to
-- injury, declared a draw". NEW column matches.result_note. add_save RPC gains
-- a 15th arg p_result_note (old 14-arg signature DROPPED for overload safety;
-- grant re-applied to anon+authenticated — token-gated internally). The admin
-- state RPC's match shape exposes result_note; the player-token state RPC
-- already returns it via to_jsonb(m.*). Client surfaces it on the result card.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS result_note text;

DROP FUNCTION IF EXISTS public.admin_save_match_result(text, text, text, integer, integer, text, integer, text[], text[], jsonb, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.admin_save_match_result(p_admin_token text, p_match_id text, p_score_type text, p_score_a integer, p_score_b integer, p_winner text, p_margin integer, p_team_a text[], p_team_b text[], p_scorers jsonb, p_motm text, p_last_goal_scorer text, p_bib_holder text, p_team_switches jsonb DEFAULT NULL::jsonb, p_result_note text DEFAULT NULL::text)
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
    team_switches    = p_team_switches,
    result_note      = NULLIF(p_result_note, '')
  WHERE id = v_match_id AND team_id = v_team_id;

  IF NOT FOUND THEN
    INSERT INTO matches (id, team_id, match_date, score_a, score_b, score_type,
                         winner, team_a, team_b, scorers, last_goal_scorer,
                         motm, bib_holder, cancelled, voting_open, team_switches, result_note)
    VALUES (v_match_id, v_team_id, COALESCE(v_match_date, CURRENT_DATE),
            p_score_a, p_score_b,
            COALESCE(NULLIF(p_score_type, ''), 'exact'),
            v_winner, to_jsonb(p_team_a), to_jsonb(p_team_b),
            p_scorers, p_last_goal_scorer, NULLIF(p_motm, ''),
            NULLIF(p_bib_holder, ''), false, false, p_team_switches, NULLIF(p_result_note, ''));
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

  -- 268 Fix 3 (SESSION 80): reconcile any pre-existing player_match row left
  -- attended=true / result NULL after the array upserts — e.g. a player dropped
  -- from p_team_a/p_team_b by an un-injure that failed to restore (pre-mig-268).
  -- Runs BEFORE the flat W/L/D + owes bump so player_match and the flat columns
  -- can never disagree. A row with a known side derives its result; a sideless
  -- attended row is unscoreable and is demoted out of the count.
  UPDATE player_match pm
  SET result = CASE
                 WHEN pm.team_assignment = v_winner THEN 'w'
                 WHEN v_winner = 'D'                THEN 'd'
                 ELSE 'l'
               END
  WHERE pm.match_id        = v_match_id
    AND pm.team_id         = v_team_id
    AND pm.attended        = true
    AND pm.result IS NULL
    AND pm.team_assignment IN ('A','B');

  UPDATE player_match pm
  SET attended = false
  WHERE pm.match_id        = v_match_id
    AND pm.team_id         = v_team_id
    AND pm.attended        = true
    AND pm.result IS NULL
    AND pm.team_assignment IS NULL;

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

    UPDATE schedule SET game_is_live = false WHERE id = v_schedule_id;

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
                             'winner', v_winner, 'is_fresh_save', v_is_fresh_save,
                             'has_note', (NULLIF(p_result_note, '') IS NOT NULL)));

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id,
                            'is_fresh_save', v_is_fresh_save);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_save_match_result(text, text, text, integer, integer, text, integer, text[], text[], jsonb, text, text, text, jsonb, text) TO anon, authenticated;

-- ── admin state RPC: result_note on match shape (player-token uses to_jsonb) ──
CREATE OR REPLACE FUNCTION public.get_team_state_by_admin_token(p_admin_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id    text;
  v_team       jsonb;
  v_squad      jsonb;
  v_schedule   jsonb;
  v_matches    jsonb;
  v_bib_hist   jsonb;
  v_settings   jsonb;
  v_cover_pool jsonb;
  v_lckey      text;
BEGIN
  IF p_admin_token IS NULL THEN RETURN NULL; END IF;

  SELECT
    t.id,
    jsonb_build_object(
      'id',                  t.id,
      'name',                t.name,
      'join_code',           t.join_code,
      'onboarding_complete', t.onboarding_complete,
      'admin_email',         t.admin_email,
      'live_channel_key',    t.live_channel_key,
      'created_at',          t.created_at
    )
  INTO v_team_id, v_team
  FROM teams t
  WHERE t.admin_token = p_admin_token;

  IF v_team_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                     p.id,
        'name',                   p.name,
        'nickname',               p.nickname,
        'status',                 p.status,
        'type',                   p.type,
        'priority',               p.priority,
        'paid',                   p.paid,
        'owes',                   p.owes,
        'self_paid',              p.self_paid,
        'paid_by',                p.paid_by,
        'pay_count',              p.pay_count,
        'goals',                  p.goals,
        'motm',                   p.motm,
        'attended',               p.attended,
        'total',                  p.total,
        'w',                      p.w,
        'l',                      p.l,
        'd',                      p.d,
        'bib_count',              p.bib_count,
        'late_dropouts',          p.late_dropouts,
        'injured',                p.injured,
        'injured_since',          p.injured_since,
        'is_guest',               p.is_guest,
        'guest_of',               p.guest_of,
        'pending_approval',               p.pending_approval,
        'note',                   p.note,
        'is_vice_captain',        tp.is_vice_captain,
        'group_number',           tp.group_number,
        'reserve_priority_order', tp.reserve_priority_order,
        'disabled',               p.disabled,
        'disable_reason',         p.disable_reason,
        'admin_locked_in',        p.admin_locked_in,
        'team',                   p.team,
        'token',                  p.token,
        'is_self',                (p.user_id IS NOT NULL AND p.user_id = auth.uid())
      )
      ORDER BY tp.created_at, p.id
    ),
    '[]'::jsonb
  )
  INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id;

  SELECT to_jsonb(s.*)
  INTO   v_schedule
  FROM   schedule s
  WHERE  s.team_id = v_team_id
  AND    s.active  = true
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                    m.id,
        'team_id',               m.team_id,
        'match_date',            m.match_date,
        'score_a',               m.score_a,
        'score_b',               m.score_b,
        'score_type',            m.score_type,
        'last_goal_scorer',      m.last_goal_scorer,
        'scorers',               m.scorers,
        'motm',                  m.motm,
        'bib_holder',            m.bib_holder,
        'team_a',                m.team_a,
        'team_b',                m.team_b,
        'teams_draft',           m.teams_draft,
        'winner',                m.winner,
        'cancelled',             m.cancelled,
        'cancel_reason',         m.cancel_reason,
        'result_note',         m.result_note,
        'voting_open',           m.voting_open,
        'voting_closes_at',      m.voting_closes_at,
        'vote_count',            m.vote_count,
        'total_voters',          m.total_voters,
        'was_admin_decided',     m.was_admin_decided,
        'admin_decision_pending',m.admin_decision_pending,
        'tied_candidates',       m.tied_candidates,
        'payments',              m.payments,
        'created_at',            m.created_at,
        'team_switches',         m.team_switches
      )
      ORDER BY m.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM matches m
  WHERE m.team_id = v_team_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'team_id',    bh.team_id,
        'player_id',  bh.player_id,
        'name',       bh.name,
        'match_date', bh.match_date,
        'returned',   bh.returned
      )
      ORDER BY bh.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_bib_hist
  FROM bib_history bh
  WHERE bh.team_id = v_team_id;

  SELECT jsonb_build_object(
    'group_name',   s.group_name,
    'group_labels', s.group_labels
  )
  INTO   v_settings
  FROM   settings s
  WHERE  s.team_id = v_team_id
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',      cp.id,
        'team_id', cp.team_id,
        'name',    cp.name,
        'played',  cp.played,
        'owes',    cp.owes
      )
    ),
    '[]'::jsonb
  )
  INTO v_cover_pool
  FROM cover_pool cp
  WHERE cp.team_id = v_team_id;

  SELECT t.live_channel_key
  INTO   v_lckey
  FROM   teams t
  WHERE  t.id = v_team_id;

  RETURN jsonb_build_object(
    'team',             v_team,
    'squad',            v_squad,
    'schedule',         v_schedule,
    'matches',          v_matches,
    'bib_history',      v_bib_hist,
    'settings',         v_settings,
    'cover_pool',       v_cover_pool,
    'live_channel_key', v_lckey
  );
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
