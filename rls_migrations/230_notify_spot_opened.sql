-- Migration 230: reliable server-side "a spot's opened — claim it" reserve notification
--
-- Replaces the fragile client-only spotOpened push (fired only from the dropping
-- player's own device, only via the self-toggle) with a server-side trigger that
-- fires on ANY spot-freeing transition: a player leaves 'in' (self/admin/injury),
-- or an in-player is disabled. Always notifies just the NEXT reserve in the queue.
-- No auto-promotion — the reserve still taps to claim.
--
-- Mirrors the mig-225 venue-ins pattern (status trigger -> notification,
-- exception-swallowing so it can never break the player write). Posts to
-- /api/notify DIRECT mode (no auth) via net.http_post; notify.js does all gating
-- (trigger config, quiet hours, injured filter, logging). MUST use the canonical
-- www URL — the apex 307-redirects and drops the POST body (mig 049).
--
-- Anti-spam: admin_go_live / admin_go_live_for_team reset the WHOLE squad to
-- status='none' in one statement; a row-level trigger fires mid-statement when
-- later reserve rows may still read 'reserve'. Both go-live RPCs now set a
-- transaction-local GUC inorout.bulk_reset before the reset, and the trigger
-- returns immediately when it is set.

-- ── 1. notify_spot_opened trigger function ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_spot_opened()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id   text;
  v_squad     int;
  v_game_dt   timestamptz;
  v_day       text;
  v_in_count  int;
  v_reserve   text;
BEGIN
  -- Skip the weekly bulk reset (go-live sets this transaction-local flag).
  IF COALESCE(current_setting('inorout.bulk_reset', true), '') <> '' THEN
    RETURN NEW;
  END IF;

  SELECT team_id INTO v_team_id FROM team_players WHERE player_id = NEW.id LIMIT 1;
  IF v_team_id IS NULL THEN RETURN NEW; END IF;

  -- Only for the active, live, non-cancelled game.
  SELECT squad_size, game_date_time, day_of_week
    INTO v_squad, v_game_dt, v_day
    FROM schedule
   WHERE team_id = v_team_id AND active = true
     AND game_is_live = true AND COALESCE(is_cancelled, false) = false
   LIMIT 1;
  IF v_squad IS NULL THEN RETURN NEW; END IF;

  -- Only if a spot is genuinely open right now.
  SELECT count(*) INTO v_in_count
    FROM players p JOIN team_players tp ON tp.player_id = p.id
   WHERE tp.team_id = v_team_id
     AND p.status = 'in' AND NOT p.disabled AND NOT p.injured;
  IF v_in_count >= v_squad THEN RETURN NEW; END IF;

  -- The NEXT reserve only (lowest priority order).
  SELECT p.id INTO v_reserve
    FROM players p JOIN team_players tp ON tp.player_id = p.id
   WHERE tp.team_id = v_team_id AND p.status = 'reserve' AND NOT p.disabled
   ORDER BY tp.reserve_priority_order NULLS LAST, tp.created_at
   LIMIT 1;
  IF v_reserve IS NULL THEN RETURN NEW; END IF;

  -- Fire-and-forget push (direct mode, canonical www URL).
  PERFORM net.http_post(
    url     := 'https://www.in-or-out.com/api/notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'type',      'spotOpened',
      'teamId',    v_team_id,
      'playerIds', jsonb_build_array(v_reserve),
      'payload',   jsonb_build_object(
        'title', 'In or Out ⚽',
        'body',  '🟣 A spot''s opened up for ' || COALESCE(v_day, 'the game') || ' — tap to claim it!',
        'icon',  '/icons/icon-192.png'),
      'gameDate',  to_char(v_game_dt, 'YYYY-MM-DD')
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- never break the player status write (Hard Rule #9)
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_spot_opened() FROM PUBLIC;
-- Trigger function — invoked only via the trigger, never directly. Strip the
-- Supabase default anon/authenticated EXECUTE grants for hygiene.
REVOKE EXECUTE ON FUNCTION public.notify_spot_opened() FROM anon, authenticated;

DROP TRIGGER IF EXISTS players_spot_opened_notify ON public.players;
CREATE TRIGGER players_spot_opened_notify
  AFTER UPDATE OF status, disabled ON public.players
  FOR EACH ROW
  WHEN (
       (OLD.status = 'in' AND NEW.status IS DISTINCT FROM 'in')
    OR (COALESCE(NEW.disabled, false) AND NOT COALESCE(OLD.disabled, false) AND OLD.status = 'in')
  )
  EXECUTE FUNCTION public.notify_spot_opened();

-- ── 2. admin_go_live: set the bulk-reset guard before the squad reset ────────
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

-- ── 3. admin_go_live_for_team: same guard ───────────────────────────────────
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
    UPDATE players SET
      status          = 'none',
      admin_locked_in = false,
      team            = NULL
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
