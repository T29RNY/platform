-- Migration 073 DOWN: Revert admin_set_vice_captain to original (no VC auth fallback)

CREATE OR REPLACE FUNCTION admin_set_vice_captain(
  p_admin_token text,
  p_player_id   text,
  p_is_vc       boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id  text;
  v_is_guest boolean;
  v_result   jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF p_is_vc IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  -- Guest guard: guests cannot be made vice captain
  SELECT is_guest INTO v_is_guest FROM players WHERE id = p_player_id;
  IF v_is_guest = true AND p_is_vc = true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden';
  END IF;

  UPDATE team_players
  SET    is_vice_captain = p_is_vc
  WHERE  team_id   = v_team_id
    AND  player_id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_vc_updated', 'player', p_player_id,
    jsonb_build_object('is_vice_captain', p_is_vc)
  );

  SELECT jsonb_build_object(
    'id',             p.id,
    'name',           p.name,
    'nickname',       p.nickname,
    'status',         p.status,
    'type',           p.type,
    'priority',       p.priority,
    'paid',           p.paid,
    'owes',           p.owes,
    'self_paid',      p.self_paid,
    'paid_by',        p.paid_by,
    'pay_count',      p.pay_count,
    'goals',          p.goals,
    'motm',           p.motm,
    'attended',       p.attended,
    'total',          p.total,
    'w',              p.w,
    'l',              p.l,
    'd',              p.d,
    'bib_count',      p.bib_count,
    'late_dropouts',  p.late_dropouts,
    'injured',        p.injured,
    'injured_since',  p.injured_since,
    'is_guest',       p.is_guest,
    'guest_of',       p.guest_of,
    'note',           p.note,
    'is_vice_captain',tp.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p
  JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = v_team_id
  WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_vc_toggled'); -- Phase A §11.2 locked

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;
