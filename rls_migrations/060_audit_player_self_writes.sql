-- ════════════════════════════════════════════════════════════════════════════
-- 060 — Audit log for player self-writes (status + paid)
-- ════════════════════════════════════════════════════════════════════════════
-- set_player_status and set_player_paid previously did the write and emitted
-- a realtime notify, but left no server-side trace. When a client tap "looks
-- saved" but the DB says otherwise, there was no way to tell from the server
-- side whether the RPC ever ran, whether auth was attached, or what value
-- was written.
--
-- This migration adds one INSERT into audit_events at the end of each
-- function. Mirrors the established pattern in admin_set_vice_captain et al.
-- Pure addition; no signature change, no behaviour change apart from the new
-- audit row. If the INSERT fails the whole RPC fails — same guarantee the
-- admin RPCs already provide.
--
-- Diagnostic value:
--   No row             → RPC never ran (client-side: no auth, dead network,
--                        swallowed exception, expired token).
--   actor_user_id NULL → caller had no auth session at tap time.
--   actor_user_id set  → RPC ran fine; bug is elsewhere (race, realtime,
--                        downstream reset).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_player_status(p_token text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id    text;
  v_team_id      text;
  v_prev_status  text;
  v_cap          int;
  v_in_count     int;
  v_locked       boolean;
  v_result       jsonb;
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

  -- Lock guard: refuse self-restore to 'in' while admin-locked
  IF p_status = 'in' THEN
    SELECT admin_locked_in INTO v_locked FROM players WHERE id = v_player_id;
    IF v_locked = true THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'admin_locked_in';
    END IF;

    -- Cap guard: refuse if team at squad_size (defence-in-depth)
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

  -- Capture previous status for audit metadata
  SELECT status INTO v_prev_status FROM players WHERE id = v_player_id;

  UPDATE players
  SET    status = p_status
  WHERE  id     = v_player_id;

  -- 060: audit every self-status write so silent client-side failures
  -- become diagnosable. actor_user_id will be null for anon callers — that
  -- itself is diagnostic (caller had no auth session at tap time).
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_status_set', 'player', v_player_id,
    jsonb_build_object(
      'status',          p_status,
      'previous_status', v_prev_status
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
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p
  WHERE p.id = v_player_id;

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

  -- 060: audit every self-paid declaration so silent client-side failures
  -- become diagnosable.
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_paid_self_declared', 'player', v_player_id,
    jsonb_build_object(
      'match_id',     v_match_id,
      'ledger_id',    v_ledger_id,
      'owes_cleared', v_owes
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
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_player_json
  FROM players p
  WHERE p.id = v_player_id;

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
