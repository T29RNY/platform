-- 243: Opening a new casual week now also resets the squad's per-game payment
-- flags (paid / self_paid / paid_by / paid_at) — NOT the running owes balance.
--
-- THE BUG (reported session 82): players.paid is a per-CURRENT-game flag, but
-- it was only ever recomputed at end-of-game (admin_save_match_result, mig 241).
-- go-live reset status='none' but left paid untouched (mig 204 deliberately
-- carried it over). Result: from the moment a new week opened until that new
-- game's result was saved, My View showed "✓ Paid" — and the admin Payments
-- screen listed last week's payers under "PAID UP" — for a game nobody had paid
-- for yet. The flag is meant to mean "paid for the game that is currently open";
-- a brand-new game = nobody has paid yet.
--
-- WHY THIS IS SAFE:
--   • owes is a fully independent accumulator column (owes = owes + price at
--     result-save; cleared by mark-paid/waive). It is INTENTIONALLY left
--     untouched here — debts must persist across weeks.
--   • payment_ledger is the permanent per-match record. Clearing the flat flag
--     loses no history (the admin ledger drawer reads the ledger).
--   • The post-game reconciliation window is preserved: paid still persists from
--     result-save right up until the NEXT game opens — go-live is the correct
--     boundary to clear it.
--
-- Reset is gated to the new-match-creation path only (v_match_id IS NULL), so
-- idempotent re-calls and reopen (mig 032, same game) never wipe payments.
--
-- Touches both go-live entry points:
--   admin_go_live          — manual "Open Next Week" (admin token, anon/auth)
--   admin_go_live_for_team — cron auto-open (service_role only)
-- Signatures unchanged → CREATE OR REPLACE preserves existing grants.

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

    -- Anti-spam for the spot-opened trigger (mig 230): mark this as a bulk
    -- squad reset so notify_spot_opened() skips the mass in->none transitions.
    PERFORM set_config('inorout.bulk_reset', v_team_id, true);

    -- PERSISTENT GUESTS (216): guests are NO LONGER deleted on rollover. The
    -- bulk reset below already includes guests (they have team_players rows),
    -- leaving them dormant (status='none', team=NULL, admin_locked_in=false).
    -- mig 243: also clear per-game payment flags so the new game opens with a
    -- clean paid slate. owes is the running balance and is left untouched.
    UPDATE players SET
      status          = 'none',
      admin_locked_in = false,
      team            = NULL,
      paid            = false,
      self_paid       = false,
      paid_by         = NULL,
      paid_at         = NULL
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

    -- Anti-spam for the spot-opened trigger (mig 230).
    PERFORM set_config('inorout.bulk_reset', p_team_id, true);

    -- PERSISTENT GUESTS (216): no guest delete; bulk reset -> dormant.
    -- mig 243: also clear per-game payment flags (owes left untouched).
    UPDATE players SET
      status          = 'none',
      admin_locked_in = false,
      team            = NULL,
      paid            = false,
      self_paid       = false,
      paid_by         = NULL,
      paid_at         = NULL
    WHERE id IN (SELECT player_id FROM team_players WHERE team_id = p_team_id);
  END IF;

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
