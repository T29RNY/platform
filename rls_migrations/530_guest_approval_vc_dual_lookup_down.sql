-- Down for 530: restore the pre-fix bodies (admin_token-only caller resolution).
-- NOTE: reverting reintroduces the VC failure — Approve/Decline of a pending +1
-- fails with invalid_admin_token for every Vice Captain. Kept for parity only.

CREATE OR REPLACE FUNCTION public.admin_approve_guest(p_admin_token text, p_guest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id    text;
  v_host_id    text;
  v_cap        integer;
  v_in_count   bigint;
  v_new_status text;
  v_result     jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT p.guest_of INTO v_host_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.id = p_guest_id
     AND tp.team_id = v_team_id
     AND p.is_guest = true
     AND p.pending_approval = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  SELECT s.squad_size INTO v_cap
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  SELECT COUNT(*) INTO v_in_count
    FROM players p2
    JOIN team_players tp2 ON tp2.player_id = p2.id
    WHERE tp2.team_id = v_team_id
      AND p2.status = 'in'
      AND NOT p2.disabled;

  IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
    v_new_status := 'reserve';
  ELSE
    v_new_status := 'in';
  END IF;

  UPDATE players
     SET status = v_new_status,
         pending_approval = false
   WHERE id = p_guest_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'guest_approved', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_host_id, 'resulting_status', v_new_status)
  );

  SELECT jsonb_build_object(
    'id',               p.id,
    'name',             p.name,
    'nickname',         p.nickname,
    'status',           p.status,
    'type',             p.type,
    'priority',         p.priority,
    'paid',             p.paid,
    'owes',             p.owes,
    'self_paid',        p.self_paid,
    'paid_by',          p.paid_by,
    'pay_count',        p.pay_count,
    'goals',            p.goals,
    'motm',             p.motm,
    'attended',         p.attended,
    'total',            p.total,
    'w',                p.w,
    'l',                p.l,
    'd',                p.d,
    'bib_count',        p.bib_count,
    'late_dropouts',    p.late_dropouts,
    'injured',          p.injured,
    'injured_since',    p.injured_since,
    'is_guest',         p.is_guest,
    'guest_of',         p.guest_of,
    'pending_approval', p.pending_approval,
    'note',             p.note,
    'disabled',         p.disabled,
    'team',             p.team,
    'token',            p.token
  ) INTO v_result
  FROM players p WHERE p.id = p_guest_id;

  PERFORM notify_team_change(v_team_id, 'guest_approved');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_decline_guest(p_admin_token text, p_guest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id text;
  v_host_id text;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT p.guest_of INTO v_host_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.id = p_guest_id
     AND tp.team_id = v_team_id
     AND p.is_guest = true
     AND p.pending_approval = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  UPDATE players
     SET pending_approval = false,
         status           = 'none',
         team             = NULL,
         admin_locked_in  = false
   WHERE id = p_guest_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'guest_declined', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_host_id, 'mode', 'dormant')
  );

  PERFORM notify_team_change(v_team_id, 'guest_declined');

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;
