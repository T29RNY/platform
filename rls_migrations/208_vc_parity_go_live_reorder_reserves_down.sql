-- DOWN 208: restore the pre-VC-parity bodies (bare admin_token lookup,
-- hardcoded 'team_admin' actor). Strict revert of 208 up. Re-introduces the
-- VC-rejection bug — that is the correct behaviour of a down migration.

CREATE OR REPLACE FUNCTION public.admin_go_live(p_admin_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_reorder_reserves(p_admin_token text, p_reserve_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id      text;
  v_actual_count int;
  v_sent_count   int;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
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
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
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
