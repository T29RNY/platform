-- 071 DOWN — restore live function without token-in-squad / v_privileged.
-- Captured from pg_get_functiondef pre-071.

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
BEGIN
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN RETURN NULL; END IF;

  SELECT team_id INTO v_team_id FROM team_players
  WHERE player_id = v_player_id ORDER BY created_at ASC LIMIT 1;
  IF v_team_id IS NULL THEN RETURN NULL; END IF;

  SELECT to_jsonb(p.*) INTO v_player FROM players p WHERE id = v_player_id;
  SELECT tp.is_vice_captain INTO v_is_vc
  FROM team_players tp
  WHERE tp.player_id = v_player_id AND tp.team_id = v_team_id;
  v_player := v_player || jsonb_build_object('is_vice_captain', v_is_vc);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id, 'name', p.name, 'nickname', p.nickname,
      'status', p.status, 'type', p.type, 'priority', p.priority,
      'is_vice_captain', tp.is_vice_captain,
      'disabled', p.disabled,
      'injured', p.injured, 'is_guest', p.is_guest, 'guest_of', p.guest_of,
      'team', p.team, 'bib_count', p.bib_count, 'note', p.note
    )
  ) INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id AND tp.player_id != v_player_id;

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

  SELECT jsonb_build_object('group_name', s.group_name) INTO v_settings
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

SELECT pg_notify('pgrst', 'reload schema');
