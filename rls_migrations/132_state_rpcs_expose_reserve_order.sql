-- ════════════════════════════════════════════════════════════════════════════
-- 132 — Expose team_players.reserve_priority_order on state RPCs
-- ════════════════════════════════════════════════════════════════════════════
-- Mig 130 added the column; mig 131 added the writer. This mig adds the
-- field to the read path so clients can sort reserves by stored priority.
--
-- Three sites updated (one new line each):
--   - get_team_state_by_admin_token squad jsonb
--   - get_team_state_by_player_token PRIVILEGED branch squad jsonb
--   - get_team_state_by_player_token NON-PRIVILEGED branch squad jsonb
--
-- Plus extension of v_player on get_team_state_by_player_token so the
-- player's own reserve position is available without depending on the
-- squad payload (which excludes self in the non-privileged branch).
--
-- Function bodies preserved byte-for-byte except for these additions.
-- search_path settings preserved as-is per existing definitions.
-- ════════════════════════════════════════════════════════════════════════════

-- ── get_team_state_by_admin_token ──────────────────────────────────────────
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

-- ── get_team_state_by_player_token ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_team_state_by_player_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_player_id           text;
  v_team_id             text;
  v_player              jsonb;
  v_squad               jsonb;
  v_schedule            jsonb;
  v_matches             jsonb;
  v_bib_hist            jsonb;
  v_settings            jsonb;
  v_cover_pool          jsonb;
  v_lckey               text;
  v_match_stats_row     RECORD;
  v_win_rate_row        RECORD;
  v_current_run         jsonb;
  v_total_team_games    int;
  v_player_attended_all int;
  v_league_raw          jsonb;
  v_ledger              jsonb;
  v_outstanding_balance numeric;
  v_current_bib_holder  text;
  v_last_match_meta     jsonb;
  v_player_form         jsonb;
  v_active_match_id     text;
  v_is_vc               boolean;
  v_is_admin            boolean;
  v_privileged          boolean;
  v_self_reserve_order  int;
BEGIN
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN RETURN NULL; END IF;

  SELECT team_id INTO v_team_id FROM team_players
  WHERE player_id = v_player_id ORDER BY created_at ASC LIMIT 1;
  IF v_team_id IS NULL THEN RETURN NULL; END IF;

  SELECT to_jsonb(p.*) INTO v_player FROM players p WHERE id = v_player_id;

  SELECT tp.is_vice_captain, tp.reserve_priority_order
    INTO v_is_vc, v_self_reserve_order
  FROM team_players tp
  WHERE tp.player_id = v_player_id AND tp.team_id = v_team_id;

  v_player := v_player || jsonb_build_object(
    'is_vice_captain',        v_is_vc,
    'reserve_priority_order', v_self_reserve_order
  );

  SELECT EXISTS (
    SELECT 1
      FROM team_admins ta
      JOIN players cp ON cp.user_id = ta.user_id
     WHERE cp.id          = v_player_id
       AND ta.team_id     = v_team_id
       AND ta.revoked_at IS NULL
  ) INTO v_is_admin;
  v_privileged := COALESCE(v_is_vc, false) OR COALESCE(v_is_admin, false);

  IF v_privileged THEN
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
          'note',                   p.note,
          'is_vice_captain',        tp.is_vice_captain,
          'group_number',           tp.group_number,
          'reserve_priority_order', tp.reserve_priority_order,
          'disabled',               p.disabled,
          'disable_reason',         p.disable_reason,
          'admin_locked_in',        p.admin_locked_in,
          'team',                   p.team,
          'token',                  p.token,
          'is_self',                (p.id = v_player_id)
        )
        ORDER BY tp.created_at, p.id
      ),
      '[]'::jsonb
    ) INTO v_squad
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = v_team_id;
  ELSE
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id, 'name', p.name, 'nickname', p.nickname,
        'status', p.status, 'type', p.type, 'priority', p.priority,
        'is_vice_captain', tp.is_vice_captain,
        'reserve_priority_order', tp.reserve_priority_order,
        'disabled', p.disabled,
        'injured', p.injured, 'is_guest', p.is_guest, 'guest_of', p.guest_of,
        'team', p.team, 'bib_count', p.bib_count, 'note', p.note,
        'token', NULL
      )
      ORDER BY tp.created_at, p.id
    ) INTO v_squad
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = v_team_id AND tp.player_id != v_player_id;
  END IF;

  SELECT to_jsonb(s.*) INTO v_schedule
  FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  SELECT jsonb_agg(to_jsonb(m.*) ORDER BY m.match_date DESC) INTO v_matches
  FROM matches m WHERE m.team_id = v_team_id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'name', bh.name, 'player_id', bh.player_id,
      'match_date', bh.match_date, 'returned', bh.returned
    ) ORDER BY bh.match_date DESC
  ) INTO v_bib_hist
  FROM bib_history bh WHERE bh.team_id = v_team_id;

  SELECT jsonb_build_object(
    'group_name',   s.group_name,
    'group_labels', s.group_labels
  ) INTO v_settings
  FROM settings s WHERE s.team_id = v_team_id LIMIT 1;

  SELECT jsonb_agg(to_jsonb(cp.*)) INTO v_cover_pool
  FROM cover_pool cp WHERE cp.team_id = v_team_id;

  SELECT live_channel_key INTO v_lckey FROM teams WHERE id = v_team_id;

  SELECT
    COUNT(*)                                                     AS games,
    SUM(CASE WHEN pm.goals    >  0   THEN pm.goals ELSE 0 END)  AS goals,
    SUM(CASE WHEN pm.was_motm = true THEN 1        ELSE 0 END)  AS motm,
    SUM(CASE WHEN pm.result   = 'w'  THEN 1        ELSE 0 END)  AS wins,
    SUM(CASE WHEN pm.result   = 'l'  THEN 1        ELSE 0 END)  AS losses,
    SUM(CASE WHEN pm.result   = 'd'  THEN 1        ELSE 0 END)  AS draws,
    SUM(CASE WHEN pm.attended = true THEN 1        ELSE 0 END)  AS attended,
    SUM(CASE WHEN pm.had_bibs = true THEN 1        ELSE 0 END)  AS bibs
  INTO v_match_stats_row
  FROM player_match pm
  WHERE pm.player_id = v_player_id AND pm.team_id = v_team_id;

  SELECT
    COUNT(*)                                                    AS played,
    SUM(CASE WHEN pm.result = 'w' THEN 1 ELSE 0 END)           AS wins,
    SUM(CASE WHEN pm.result = 'd' THEN 1 ELSE 0 END)           AS draws,
    SUM(CASE WHEN pm.result = 'l' THEN 1 ELSE 0 END)           AS losses
  INTO v_win_rate_row
  FROM player_match pm
  WHERE pm.player_id = v_player_id
    AND pm.team_id   = v_team_id
    AND pm.attended  = true;

  SELECT jsonb_agg(r.result) INTO v_current_run
  FROM (
    SELECT pm.result
    FROM player_match pm
    JOIN matches m ON m.id = pm.match_id
    WHERE pm.player_id = v_player_id
      AND pm.team_id   = v_team_id
      AND pm.attended  = true
    ORDER BY m.match_date DESC
    LIMIT 20
  ) r;

  SELECT COUNT(*) INTO v_total_team_games
  FROM matches
  WHERE team_id = v_team_id
    AND (cancelled IS NULL OR cancelled = false);

  SELECT COUNT(*) INTO v_player_attended_all
  FROM player_match
  WHERE player_id = v_player_id
    AND team_id   = v_team_id
    AND attended  = true;

  SELECT jsonb_agg(to_jsonb(agg.*))
  INTO v_league_raw
  FROM (
    SELECT
      pm.player_id,
      COUNT(*)                                                   AS played,
      SUM(CASE WHEN pm.result   = 'w'  THEN 1 ELSE 0 END)       AS wins,
      SUM(CASE WHEN pm.result   = 'd'  THEN 1 ELSE 0 END)       AS draws,
      SUM(CASE WHEN pm.result   = 'l'  THEN 1 ELSE 0 END)       AS losses,
      SUM(pm.goals)                                              AS goals,
      SUM(CASE WHEN pm.was_motm = true THEN 1 ELSE 0 END)       AS motm,
      SUM(CASE WHEN pm.had_bibs = true THEN 1 ELSE 0 END)       AS bibs,
      SUM(CASE WHEN pm.attended = true THEN 1 ELSE 0 END)       AS attended
    FROM player_match pm
    WHERE pm.team_id = v_team_id
    GROUP BY pm.player_id
  ) agg;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',         pl.id,
      'amount',     pl.amount,
      'type',       pl.type,
      'status',     pl.status,
      'method',     pl.method,
      'paid_by',    pl.paid_by,
      'paid_at',    pl.paid_at,
      'match_id',   pl.match_id,
      'note',       pl.note,
      'created_at', pl.created_at
    ) ORDER BY pl.created_at DESC
  ) INTO v_ledger
  FROM (
    SELECT * FROM payment_ledger
    WHERE player_id = v_player_id
      AND team_id   = v_team_id
    ORDER BY created_at DESC
    LIMIT 20
  ) pl;

  SELECT COALESCE(SUM(amount), 0) INTO v_outstanding_balance
  FROM payment_ledger
  WHERE player_id = v_player_id
    AND team_id   = v_team_id
    AND status    = 'unpaid';

  SELECT bh.player_id INTO v_current_bib_holder
  FROM bib_history bh
  WHERE bh.team_id  = v_team_id
    AND bh.returned = false
  ORDER BY bh.match_date DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'motm',       m.motm,
    'bib_holder', COALESCE(v_current_bib_holder, m.bib_holder),
    'match_date', m.match_date
  ) INTO v_last_match_meta
  FROM matches m
  WHERE m.team_id   = v_team_id
    AND m.cancelled = false
    AND m.winner    IS NOT NULL
  ORDER BY m.match_date DESC
  LIMIT 1;

  SELECT jsonb_agg(
    jsonb_build_object(
      'player_id', agg.player_id,
      'form',      agg.form
    )
  ) INTO v_player_form
  FROM (
    SELECT
      pm.player_id,
      jsonb_agg(pm.result ORDER BY m.match_date DESC) AS form
    FROM player_match pm
    JOIN matches m ON m.id = pm.match_id
    WHERE pm.team_id   = v_team_id
      AND pm.attended  = true
      AND m.cancelled  = false
    GROUP BY pm.player_id
  ) agg;

  RETURN jsonb_build_object(
    'player',           v_player,
    'squad',            v_squad,
    'schedule',         v_schedule,
    'matches',          v_matches,
    'bib_history',      v_bib_hist,
    'settings',         v_settings,
    'cover_pool',       v_cover_pool,
    'live_channel_key', v_lckey,
    'team_id',          v_team_id,
    'stats', jsonb_build_object(
      'match_stats', jsonb_build_object(
        'games',    v_match_stats_row.games,
        'goals',    v_match_stats_row.goals,
        'motm',     v_match_stats_row.motm,
        'wins',     v_match_stats_row.wins,
        'losses',   v_match_stats_row.losses,
        'draws',    v_match_stats_row.draws,
        'attended', v_match_stats_row.attended,
        'bibs',     v_match_stats_row.bibs
      ),
      'win_rate', jsonb_build_object(
        'played', v_win_rate_row.played,
        'wins',   v_win_rate_row.wins,
        'draws',  v_win_rate_row.draws,
        'losses', v_win_rate_row.losses
      ),
      'current_run',         v_current_run,
      'reliability', jsonb_build_object(
        'attended',   v_player_attended_all,
        'totalGames', v_total_team_games
      ),
      'league_raw',          v_league_raw,
      'ledger',              v_ledger,
      'outstanding_balance', v_outstanding_balance,
      'last_match_meta',     v_last_match_meta,
      'player_form',         v_player_form
    )
  );
END;
$function$;
