-- Migration 077: admin_go_live RPC
-- Applied to remote 2026-05-26 via MCP. Verified end-to-end:
--   • brand-new squad's first go-live now creates a matches row and
--     sets schedule.active_match_id, so Make Teams / POTM voting /
--     payment confirmation / save-teams all work on day one.
--   • Idempotent: re-calling reuses the existing non-cancelled match.
--   • audit_events row written with action='week_opened'.
--   • notify_team_change(team_id, 'week_opened') published.
--
-- Fixes the brand-new-squad first-go-live bug. admin_upsert_schedule
-- sets game_is_live=true but never inserts a matches row or sets
-- schedule.active_match_id. Only admin_reopen_week (migration 032) did
-- that, and only on the cancel->relive path. For a brand-new squad's
-- first ever go-live, active_match_id stayed NULL and TeamsScreen's
-- matchId resolver (schedule.activeMatchId → matchHistory fallback)
-- found nothing → "No active match — go live first before picking
-- teams" empty state.
--
-- This RPC owns the full first-go-live transaction:
--   - inserts a fresh matches row if active_match_id is NULL or stale
--   - sets game_is_live=true, is_draft=false, active_match_id
--   - audits as 'week_opened'
--   - publishes notify_team_change(team_id, 'week_opened')
--
-- Sibling of admin_reopen_week (migration 032) — same shape minus the
-- cancel-clearing semantics. admin_reopen_week stays for the
-- cancel->relive path (it also clears is_cancelled and cancel_reason).
--
-- Discovered 2026-05-26 (session 46) when rockybram's brand-new squad
-- "Footy Tuesdays" hit "No Active Match" in Make Teams on first
-- go-live. Unblocked rockybram via admin_reopen_week as a manual
-- one-off, then shipped this RPC as the durable fix.

CREATE OR REPLACE FUNCTION admin_go_live(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id      text;
  v_schedule_id  text;
  v_game_dt      timestamptz;
  v_match_id     text;
  v_was_existing boolean := false;
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
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
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
$$;

REVOKE ALL ON FUNCTION admin_go_live(text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_go_live(text) TO authenticated, anon;
