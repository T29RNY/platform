-- DOWN 209: restore the pre-209 RPC bodies (no FK-child cleanup on guest
-- delete). admin_go_live keeps its mig-208 resolver; remove_guest_player and
-- admin_go_live_for_team revert to their prior bodies. The one-off orphan
-- DELETE in the up is NOT reversible — those rows were dangling garbage with
-- no parent player; a down cannot meaningfully resurrect them. Re-introduces
-- the orphan-leak bug, which is the correct behaviour of a down migration.

CREATE OR REPLACE FUNCTION public.remove_guest_player(p_token text, p_guest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
BEGIN
  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM players
    WHERE id       = p_guest_id
      AND guest_of = v_player_id
      AND is_guest = true
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_found';
  END IF;

  DELETE FROM team_players
  WHERE player_id = p_guest_id
    AND team_id   = v_team_id;

  DELETE FROM players WHERE id = p_guest_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'guest_player_removed_self', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_player_id)
  );

  PERFORM notify_team_change(v_team_id, 'guest_player_removed');

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

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

    DELETE FROM team_players tp
    USING players p
    WHERE tp.team_id = p_team_id
      AND tp.player_id = p.id
      AND p.is_guest = true;

    DELETE FROM players
    WHERE is_guest = true
      AND guest_of IN (
        SELECT player_id FROM team_players WHERE team_id = p_team_id
      );

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

SELECT pg_notify('pgrst', 'reload schema');
