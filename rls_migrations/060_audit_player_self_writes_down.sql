-- ════════════════════════════════════════════════════════════════════════════
-- 060 DOWN — remove audit log inserts from player self-write RPCs
-- ════════════════════════════════════════════════════════════════════════════
-- Restores set_player_status and set_player_paid to their pre-060 bodies
-- (no audit_events INSERT). Loses server-side diagnostic trace for player
-- self-writes. Safe to apply; no data loss.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_player_status(p_token text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_cap       int;
  v_in_count  int;
  v_locked    boolean;
  v_result    jsonb;
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

  IF p_status IS NULL OR p_status NOT IN ('in','out','maybe','reserve','none') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status';
  END IF;

  IF p_status = 'in' THEN
    SELECT admin_locked_in INTO v_locked FROM players WHERE id = v_player_id;
    IF v_locked = true THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'admin_locked_in';
    END IF;

    SELECT s.squad_size INTO v_cap
      FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

    SELECT COUNT(*) INTO v_in_count
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
      WHERE tp.team_id = v_team_id
        AND p.status = 'in' AND NOT p.disabled
        AND p.id <> v_player_id;

    IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'squad_full';
    END IF;
  END IF;

  UPDATE players
  SET    status = p_status
  WHERE  id     = v_player_id;

  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname,
    'status', p.status, 'type', p.type, 'priority', p.priority,
    'paid', p.paid, 'owes', p.owes, 'self_paid', p.self_paid,
    'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended,
    'total', p.total, 'w', p.w, 'l', p.l, 'd', p.d,
    'bib_count', p.bib_count, 'late_dropouts', p.late_dropouts,
    'injured', p.injured, 'injured_since', p.injured_since,
    'is_guest', p.is_guest, 'guest_of', p.guest_of, 'note', p.note,
    'disabled', p.disabled, 'disable_reason', p.disable_reason,
    'team', p.team
  )
  INTO v_result
  FROM players p WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_status_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;


CREATE OR REPLACE FUNCTION public.set_player_paid(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id   text;
  v_team_id     text;
  v_match_id    text;
  v_price       numeric;
  v_owes        numeric := 0;
  v_ledger_id   text;
  v_player_json jsonb;
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

  SELECT s.active_match_id, s.price_per_player
    INTO v_match_id, v_price
    FROM schedule s
   WHERE s.team_id = v_team_id
     AND s.active  = true
   LIMIT 1;

  SELECT COALESCE(owes, 0) INTO v_owes FROM players WHERE id = v_player_id;

  UPDATE players
  SET    self_paid = true,
         paid_by   = 'self'
  WHERE  id = v_player_id;

  IF v_owes > 0 THEN
    INSERT INTO payment_ledger
      (team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at)
    VALUES
      (v_team_id, v_player_id, null, v_owes, 'debt_payment', 'paid', 'cash', 'self', now());
    UPDATE players SET owes = 0 WHERE id = v_player_id;
  END IF;

  SELECT id
    INTO v_ledger_id
    FROM payment_ledger
   WHERE player_id = v_player_id
     AND team_id   = v_team_id
     AND type      = 'game_fee'
     AND (
       (v_match_id IS NOT NULL AND match_id = v_match_id)
       OR (v_match_id IS NULL AND match_id IS NULL)
     )
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    UPDATE payment_ledger
    SET    status  = 'unpaid',
           method  = 'cash',
           paid_by = 'self'
    WHERE  id = v_ledger_id;
  ELSE
    INSERT INTO payment_ledger
      (team_id, player_id, match_id, amount, type, status, method, paid_by)
    VALUES
      (v_team_id, v_player_id, v_match_id, COALESCE(v_price, 0), 'game_fee', 'unpaid', 'cash', 'self')
    RETURNING id INTO v_ledger_id;
  END IF;

  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname,
    'status', p.status, 'type', p.type, 'priority', p.priority,
    'paid', p.paid, 'owes', p.owes, 'self_paid', p.self_paid,
    'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended,
    'total', p.total, 'w', p.w, 'l', p.l, 'd', p.d,
    'bib_count', p.bib_count, 'late_dropouts', p.late_dropouts,
    'injured', p.injured, 'injured_since', p.injured_since,
    'is_guest', p.is_guest, 'guest_of', p.guest_of, 'note', p.note,
    'disabled', p.disabled, 'disable_reason', p.disable_reason,
    'team', p.team
  )
  INTO v_player_json
  FROM players p WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_paid_updated');

  RETURN jsonb_build_object(
    'player',    v_player_json,
    'ledger_id', v_ledger_id
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
