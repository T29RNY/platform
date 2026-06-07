-- 208: complete VC parity for the two admin RPCs the mig-075 sweep missed.
--
-- Audit (session 71) found admin_go_live and admin_reorder_reserves still
-- authenticate with a bare `SELECT id FROM teams WHERE admin_token = p_admin_token`,
-- with NO Vice-Captain fallback. A VC operates AdminView via /p/<vc_token>, so the
-- 21-char player token never matches a 28-char team admin_token → invalid_admin_token,
-- and the VC's "Open Next Week" / reserve-reorder silently fails. Same class as the
-- mig-116 (admin_delete_player) and mig-162 (teamsheet) VC bugs; the settled fix is
-- resolve_admin_caller(p_token) (admin_token OR VC player_token), already used by the
-- other 25 casual admin_* RPCs.
--
-- Only change to each body: the auth lookup swaps to resolve_admin_caller, and the
-- audit_events insert uses the resolved actor_type / actor_identifier (so a VC action
-- logs as 'vice_captain' instead of a hardcoded 'team_admin'). Everything else is
-- re-applied byte-for-byte for a single source of truth. No grant change — both
-- functions are already granted to anon + authenticated (token check is the gate).
-- admin_go_live also keeps its mig-204/207 squad-reset + guest-cleanup block intact.

CREATE OR REPLACE FUNCTION public.admin_go_live(p_admin_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id      text;
  v_actor_type   text;
  v_actor_ident  text;
  v_schedule_id  text;
  v_game_dt      timestamptz;
  v_match_id     text;
  v_was_existing boolean := false;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id, game_date_time, active_match_id
    INTO v_schedule_id, v_game_dt, v_match_id
    FROM schedule
    WHERE team_id = v_team_id AND active = true
    LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_active_schedule';
  END IF;

  -- Idempotent: reuse existing non-cancelled match if active_match_id
  -- already points to a live row. Protects against double-taps and
  -- against callers using this RPC where reopen would have been used.
  IF v_match_id IS NOT NULL THEN
    PERFORM 1 FROM matches
      WHERE id = v_match_id AND COALESCE(cancelled, false) = false;
    IF FOUND THEN
      v_was_existing := true;
    ELSE
      v_match_id := NULL;
    END IF;
  END IF;

  IF v_match_id IS NULL THEN
    v_match_id := generate_url_safe_token('m_', 8);
    INSERT INTO matches (id, team_id, match_date)
    VALUES (
      v_match_id,
      v_team_id,
      COALESCE(v_game_dt::date, CURRENT_DATE)
    );

    -- Remove stale guest rows — guests are per-week only, not permanent squad
    -- members. team_players must go first (NO ACTION FK); player rows are then
    -- identified via guest_of pointing to a host still on the team.
    DELETE FROM team_players tp
    USING players p
    WHERE tp.team_id = v_team_id
      AND tp.player_id = p.id
      AND p.is_guest = true;

    DELETE FROM players
    WHERE is_guest = true
      AND guest_of IN (
        SELECT player_id FROM team_players WHERE team_id = v_team_id
      );

    -- Clear last week's in/out status + A/B team assignments so the board
    -- opens fresh. Payment flags (paid/self_paid/paid_by/paid_at/owes)
    -- intentionally carry over week-to-week — the "Owes" balance depends on it.
    UPDATE players SET
      status          = 'none',
      admin_locked_in = false,
      team            = NULL
    WHERE id IN (SELECT player_id FROM team_players WHERE team_id = v_team_id);
  END IF;

  UPDATE schedule SET
    game_is_live    = true,
    is_draft        = false,
    active_match_id = v_match_id
  WHERE id = v_schedule_id AND team_id = v_team_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'week_opened', 'schedule', v_schedule_id,
    jsonb_build_object(
      'match_id',        v_match_id,
      'reused_existing', v_was_existing
    )
  );

  PERFORM notify_team_change(v_team_id, 'week_opened');

  RETURN jsonb_build_object(
    'ok',              true,
    'match_id',        v_match_id,
    'reused_existing', v_was_existing
  );

EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reorder_reserves(p_admin_token text, p_reserve_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id      text;
  v_actor_type   text;
  v_actor_ident  text;
  v_actual_count int;
  v_sent_count   int;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF p_reserve_ids IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_input';
  END IF;

  v_sent_count := COALESCE(array_length(p_reserve_ids, 1), 0);

  IF v_sent_count <> (SELECT COUNT(DISTINCT x) FROM unnest(p_reserve_ids) AS x) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='duplicate_ids';
  END IF;

  SELECT COUNT(*) INTO v_actual_count
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id AND p.status = 'reserve';

  IF v_actual_count <> v_sent_count THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='reserve_set_changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_reserve_ids) AS u(player_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM team_players tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND tp.player_id = u.player_id
        AND p.status = 'reserve'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_reserve_or_not_on_team';
  END IF;

  UPDATE team_players tp
     SET reserve_priority_order = u.ord - 1
    FROM unnest(p_reserve_ids) WITH ORDINALITY AS u(player_id, ord)
   WHERE tp.team_id = v_team_id AND tp.player_id = u.player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'admin_reorder_reserves', 'team', v_team_id,
    jsonb_build_object('reserve_ids', to_jsonb(p_reserve_ids))
  );

  PERFORM notify_team_change(v_team_id, 'player_updated');

  RETURN jsonb_build_object('ok', true, 'count', v_actual_count);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
