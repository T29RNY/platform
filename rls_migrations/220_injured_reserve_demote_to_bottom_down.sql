-- 220 DOWN: restore set_player_injured / admin_set_player_injured to the pre-220
-- bodies (no auto-demotion of injured reserves).

CREATE OR REPLACE FUNCTION public.set_player_injured(p_token text, p_injured boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_result    jsonb;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_injured IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  UPDATE players
  SET    injured       = p_injured,
         injured_since = CASE WHEN p_injured THEN now() ELSE NULL END,
         status        = CASE WHEN p_injured AND status = 'in' THEN 'out'
                              ELSE status
                         END
  WHERE  id = v_player_id;

  IF p_injured THEN
    INSERT INTO player_injuries
      (id, player_id, team_id, injured_at, cleared_at, marked_by)
    VALUES
      (gen_random_uuid(), v_player_id, v_team_id, now(), NULL, 'player');
  ELSE
    UPDATE player_injuries
    SET    cleared_at = now()
    WHERE  id = (
      SELECT id FROM player_injuries
      WHERE  player_id  = v_player_id
        AND  team_id    = v_team_id
        AND  cleared_at IS NULL
      ORDER BY injured_at DESC
      LIMIT 1
    );
  END IF;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_injured_self_set', 'player', v_player_id,
    jsonb_build_object('injured', p_injured)
  );

  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname, 'status', p.status,
    'type', p.type, 'priority', p.priority, 'paid', p.paid, 'owes', p.owes,
    'self_paid', p.self_paid, 'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended, 'total', p.total,
    'w', p.w, 'l', p.l, 'd', p.d, 'bib_count', p.bib_count,
    'late_dropouts', p.late_dropouts, 'injured', p.injured,
    'injured_since', p.injured_since, 'is_guest', p.is_guest, 'guest_of', p.guest_of,
    'note', p.note, 'disabled', p.disabled, 'disable_reason', p.disable_reason, 'team', p.team
  )
  INTO v_result FROM players p WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_injured_updated');
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_set_player_injured(p_admin_token text, p_player_id text, p_injured boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id text;
  v_result  jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF p_injured IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players
    WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  UPDATE players
  SET    injured       = p_injured,
         injured_since = CASE WHEN p_injured THEN now() ELSE NULL END,
         status        = CASE WHEN p_injured AND status = 'in' THEN 'out'
                              ELSE status
                         END
  WHERE  id = p_player_id;

  IF p_injured THEN
    INSERT INTO player_injuries
      (id, player_id, team_id, injured_at, cleared_at, marked_by)
    VALUES
      (gen_random_uuid(), p_player_id, v_team_id, now(), NULL, 'admin');
  ELSE
    UPDATE player_injuries
    SET    cleared_at = now()
    WHERE  id = (
      SELECT id FROM player_injuries
      WHERE  player_id  = p_player_id
        AND  team_id    = v_team_id
        AND  cleared_at IS NULL
      ORDER BY injured_at DESC
      LIMIT 1
    );
  END IF;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'player_injured_updated', 'player', p_player_id,
    jsonb_build_object('injured', p_injured)
  );

  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname, 'status', p.status,
    'type', p.type, 'priority', p.priority, 'paid', p.paid, 'owes', p.owes,
    'self_paid', p.self_paid, 'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended, 'total', p.total,
    'w', p.w, 'l', p.l, 'd', p.d, 'bib_count', p.bib_count,
    'late_dropouts', p.late_dropouts, 'injured', p.injured,
    'injured_since', p.injured_since, 'is_guest', p.is_guest, 'guest_of', p.guest_of,
    'note', p.note, 'disabled', p.disabled, 'disable_reason', p.disable_reason, 'team', p.team
  )
  INTO v_result FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_injured_updated');
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;
