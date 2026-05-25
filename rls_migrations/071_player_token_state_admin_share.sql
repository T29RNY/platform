-- ════════════════════════════════════════════════════════════════════════════
-- 071 — get_team_state_by_player_token: expose squad tokens to VCs/admins
-- ════════════════════════════════════════════════════════════════════════════
-- Companion to migration 070. When a VC or team_admin enters admin view via
-- their /p/<token> route, the squad payload comes from
-- get_team_state_by_player_token — which historically did not include any
-- squad-row tokens at all. SquadScreen.jsx falls back to player_id, so
-- "Copy personal link" ships a broken /p/<player_id> URL.
--
-- Fix: derive whether the caller is privileged (VC of this team, OR a
-- non-revoked team_admins row tied to the caller's user_id). If yes,
-- include p.token on every squad row. Otherwise the squad shape is
-- unchanged from pre-071 (no tokens — regular players don't need them).
--
-- Privilege is derived from the caller's player row, NOT from auth.uid().
-- Possession of the player token is the auth signal for this route.
--
-- Function body is a verbatim copy of the live function (captured from
-- pg_get_functiondef) with two surgical additions: v_privileged
-- computation, and the token field in the squad jsonb_build_object.
-- ════════════════════════════════════════════════════════════════════════════

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
BEGIN

  -- 1. resolve player
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN RETURN NULL; END IF;

  -- 2. resolve team (earliest membership)
  SELECT team_id INTO v_team_id FROM team_players
  WHERE player_id = v_player_id ORDER BY created_at ASC LIMIT 1;
  IF v_team_id IS NULL THEN RETURN NULL; END IF;

  -- 3. full self-row + inject is_vice_captain from team_players
  SELECT to_jsonb(p.*) INTO v_player FROM players p WHERE id = v_player_id;
  SELECT tp.is_vice_captain INTO v_is_vc
  FROM team_players tp
  WHERE tp.player_id = v_player_id AND tp.team_id = v_team_id;
  v_player := v_player || jsonb_build_object('is_vice_captain', v_is_vc);

  -- 3b. 071: caller privileged when VC of this team OR holds an active
  --     team_admins row tied to the caller's user_id.
  SELECT EXISTS (
    SELECT 1
      FROM team_admins ta
      JOIN players cp ON cp.user_id = ta.user_id
     WHERE cp.id          = v_player_id
       AND ta.team_id     = v_team_id
       AND ta.revoked_at IS NULL
  ) INTO v_is_admin;
  v_privileged := COALESCE(v_is_vc, false) OR COALESCE(v_is_admin, false);

  -- 4. squad (no financial/stats) — is_vice_captain from team_players
  --    071: include p.token only when caller is VC/admin.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id, 'name', p.name, 'nickname', p.nickname,
      'status', p.status, 'type', p.type, 'priority', p.priority,
      'is_vice_captain', tp.is_vice_captain,
      'disabled', p.disabled,
      'injured', p.injured, 'is_guest', p.is_guest, 'guest_of', p.guest_of,
      'team', p.team, 'bib_count', p.bib_count, 'note', p.note,
      'token', CASE WHEN v_privileged THEN p.token ELSE NULL END
    )
  ) INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id AND tp.player_id != v_player_id;

  -- 5. schedule
  SELECT to_jsonb(s.*) INTO v_schedule
  FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  -- 6. matches
  SELECT jsonb_agg(to_jsonb(m.*) ORDER BY m.match_date DESC) INTO v_matches
  FROM matches m WHERE m.team_id = v_team_id;

  -- 7. bib history
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', bh.name, 'player_id', bh.player_id,
      'match_date', bh.match_date, 'returned', bh.returned
    ) ORDER BY bh.match_date DESC
  ) INTO v_bib_hist
  FROM bib_history bh WHERE bh.team_id = v_team_id;

  -- 8. settings
  SELECT jsonb_build_object('group_name', s.group_name) INTO v_settings
  FROM settings s WHERE s.team_id = v_team_id LIMIT 1;

  -- 9. cover pool
  SELECT jsonb_agg(to_jsonb(cp.*)) INTO v_cover_pool
  FROM cover_pool cp WHERE cp.team_id = v_team_id;

  -- 9b. live channel key
  SELECT live_channel_key INTO v_lckey FROM teams WHERE id = v_team_id;

  -- 10. match_stats
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

  -- 11. win_rate (attended only)
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

  -- 12. current_run (last 20 attended, newest first)
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

  -- 13. reliability
  SELECT COUNT(*) INTO v_total_team_games
  FROM matches
  WHERE team_id = v_team_id
    AND (cancelled IS NULL OR cancelled = false);

  SELECT COUNT(*) INTO v_player_attended_all
  FROM player_match
  WHERE player_id = v_player_id
    AND team_id   = v_team_id
    AND attended  = true;

  -- 14. league_raw
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

  -- 15. ledger (last 20 entries for this player)
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

  -- 16. outstanding balance
  SELECT COALESCE(SUM(amount), 0) INTO v_outstanding_balance
  FROM payment_ledger
  WHERE player_id = v_player_id
    AND team_id   = v_team_id
    AND status    = 'unpaid';

  -- 17a. current bib holder (unreturned bib_history entry)
  SELECT bh.player_id INTO v_current_bib_holder
  FROM bib_history bh
  WHERE bh.team_id  = v_team_id
    AND bh.returned = false
  ORDER BY bh.match_date DESC
  LIMIT 1;

  -- 17b. last match meta
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

  -- 18. player form (last 5 attended results per player, newest first)
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
