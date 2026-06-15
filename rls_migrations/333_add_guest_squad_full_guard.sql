-- Migration 333: add squad-full guard to add_guest_player
--
-- Bug: add_guest_player always set status='in' unconditionally, ignoring
-- schedule.squad_size. With the multi-guest PlayerView fix (session 136)
-- a single player could add multiple guests and push the confirmed count
-- above the squad cap. This adds the same squad_full check used by every
-- other status-setting RPC.
--
-- Pattern mirrors set_player_status (mig 268).

CREATE OR REPLACE FUNCTION public.add_guest_player(p_token text, p_guest_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id   text;
  v_team_id     text;
  v_guest_id    text;
  v_guest_token text;
  v_result      jsonb;
  v_cap         integer;
  v_in_count    bigint;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
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

  -- No new guests once the match has kicked off (268 Fix 2).
  IF is_lineup_locked(v_team_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'lineup_locked';
  END IF;

  IF p_guest_name IS NULL OR length(trim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;
  IF length(trim(p_guest_name)) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  -- Squad-full guard: reject if the cap is already met.
  SELECT s.squad_size INTO v_cap
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  SELECT COUNT(*) INTO v_in_count
    FROM players p2
    JOIN team_players tp2 ON tp2.player_id = p2.id
    WHERE tp2.team_id = v_team_id
      AND p2.status = 'in'
      AND NOT p2.disabled;

  IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'squad_full';
  END IF;

  v_guest_id    := generate_url_safe_token('p_', 6);
  v_guest_token := generate_url_safe_token('p_', 12);

  INSERT INTO players (
    id, name, token, type,
    disabled, priority,
    status, paid, owes,
    goals, motm, attended, total,
    bib_count, team, w, l, d,
    pay_count, late_dropouts, note, self_paid,
    is_guest, guest_of
  ) VALUES (
    v_guest_id, trim(p_guest_name), v_guest_token, 'regular',
    false, false,
    'in', false, 0,
    0, 0, 0, 0,
    0, null, 0, 0, 0,
    0, 0, '', false,
    true, v_player_id
  );

  INSERT INTO team_players (team_id, player_id)
  VALUES (v_team_id, v_guest_id);

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'guest_player_added_self', 'player', v_guest_id,
    jsonb_build_object(
      'host_player_id', v_player_id,
      'guest_name',     trim(p_guest_name)
    )
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
    'disabled',       p.disabled,
    'token',          p.token
  ) INTO v_result
  FROM players p WHERE p.id = v_guest_id;

  RETURN v_result;
END;
$function$;
