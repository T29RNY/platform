-- ════════════════════════════════════════════════════════════════════════════
-- 126 — admin_go_live_for_team: cron-callable sibling of admin_go_live
-- ════════════════════════════════════════════════════════════════════════════
-- Bug: autoOpenGameJob in api/cron.js (the 15-min cron that opens the week
-- when opens_day/opens_time is reached) flips schedule.game_is_live=true
-- via a raw table update but does NOT create the matches row or set
-- schedule.active_match_id. That leaves the schedule in a state where
-- TeamsScreen renders "No active match" and admin Make Teams is blocked
-- until lineupLockJob backfills the matches row 60 minutes before kickoff.
--
-- Mig 077 added admin_go_live(p_admin_token) which owns the full
-- game_is_live + matches row + active_match_id transition for the admin
-- UI's Go Live toggle. The cron has team_id (not admin token), so it
-- couldn't directly call admin_go_live and bypassed it entirely.
--
-- This RPC is the team_id-keyed sibling. Strict superset of what the
-- cron's autoOpenGameJob did (game_is_live=true, auto_open_pending=false,
-- notify_team_change) PLUS the matches row + active_match_id transition
-- the admin path has had since 077. Service-role-only grant; the
-- caller is always the cron service-role client.
--
-- Audit row: actor_type='system', actor_identifier='cron:auto_open_game'.
-- Distinguishes cron-driven opens from admin-driven opens (which write
-- actor_type='team_admin') in the operational audit trail.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_go_live_for_team(p_team_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_schedule_id  text;
  v_game_dt      timestamptz;
  v_match_id     text;
  v_was_existing boolean := false;
BEGIN
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_team_id';
  END IF;

  PERFORM 1 FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_team_id';
  END IF;

  SELECT id, game_date_time, active_match_id
    INTO v_schedule_id, v_game_dt, v_match_id
    FROM schedule
    WHERE team_id = p_team_id AND active = true
    LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_active_schedule';
  END IF;

  -- Idempotent: reuse existing non-cancelled match if active_match_id
  -- already points to a live row. Protects against retries.
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
      p_team_id,
      COALESCE(v_game_dt::date, CURRENT_DATE)
    );
  END IF;

  -- Single transaction: game_is_live + auto_open_pending + active_match_id.
  -- auto_open_pending=false is the cron-specific concern (admin_go_live
  -- doesn't touch it because the admin path doesn't gate on it).
  UPDATE schedule SET
    game_is_live      = true,
    is_draft          = false,
    auto_open_pending = false,
    active_match_id   = v_match_id
  WHERE id = v_schedule_id AND team_id = p_team_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    p_team_id, 'system', NULL,
    'cron:auto_open_game',
    'week_opened', 'schedule', v_schedule_id,
    jsonb_build_object(
      'match_id',        v_match_id,
      'reused_existing', v_was_existing,
      'source',          'cron_auto_open'
    )
  );

  PERFORM notify_team_change(p_team_id, 'week_opened');

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

REVOKE ALL ON FUNCTION public.admin_go_live_for_team(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_go_live_for_team(text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_go_live_for_team(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_go_live_for_team(text) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
