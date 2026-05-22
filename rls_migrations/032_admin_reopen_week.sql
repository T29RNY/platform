-- Migration 032: admin_reopen_week RPC
-- Applied to remote 2026-05-22 via MCP. Verified end-to-end:
--   • schedule.is_cancelled flips false, game_is_live flips true,
--     active_match_id points to a fresh matches row.
--   • Previously cancelled match (if any) stays in history.
--   • audit_events row written.
--   • RPC grants match the admin_cancel_match pattern (authenticated, anon).
--
-- Resolves the cancel-then-relive toggle bug. admin_upsert_schedule
-- doesn't write is_cancelled or active_match_id, so flipping
-- game_is_live=true via the toggle after Cancel This Week left the
-- schedule in conflicting state (is_cancelled=true AND game_is_live=true,
-- active_match_id=null). This RPC owns the full reopen transaction:
-- clears the cancelled state on schedule, inserts a fresh matches row,
-- and points active_match_id at it. The previously cancelled match stays
-- in history (cancelled=true).

CREATE OR REPLACE FUNCTION admin_reopen_week(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id       text;
  v_schedule_id   text;
  v_game_dt       timestamptz;
  v_prev_match_id text;
  v_new_match_id  text;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id
    FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id, game_date_time, active_match_id
    INTO v_schedule_id, v_game_dt, v_prev_match_id
    FROM schedule
    WHERE team_id = v_team_id AND active = true
    LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_active_schedule';
  END IF;

  v_new_match_id := generate_url_safe_token('m_', 8);

  -- Fresh matches row. Defaults handle every other column.
  INSERT INTO matches (id, team_id, match_date)
  VALUES (
    v_new_match_id,
    v_team_id,
    COALESCE(v_game_dt::date, CURRENT_DATE)
  );

  UPDATE schedule SET
    is_cancelled    = false,
    cancel_reason   = NULL,
    game_is_live    = true,
    is_draft        = false,
    active_match_id = v_new_match_id
  WHERE id = v_schedule_id AND team_id = v_team_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'week_reopened', 'schedule', v_schedule_id,
    jsonb_build_object(
      'prev_match_id', v_prev_match_id,
      'new_match_id',  v_new_match_id
    )
  );

  PERFORM notify_team_change(v_team_id, 'week_reopened');

  RETURN jsonb_build_object(
    'ok',            true,
    'match_id',      v_new_match_id,
    'prev_match_id', v_prev_match_id
  );

EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE ALL ON FUNCTION admin_reopen_week(text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_reopen_week(text) TO authenticated, anon;
