-- =============================================================================
-- MIGRATION 082 DOWN: restore admin_cancel_match to pre-082 body
-- =============================================================================
-- Reverts the Step 5 SET list to the pre-082 four columns
-- (status, paid, self_paid, paid_by). Everything else identical to mig 082
-- (including resolve_admin_caller and the dynamic actor_type audit insert).
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_cancel_match(
  p_admin_token   text,
  p_cancel_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_type  text;
  v_actor_ident text;
  v_team_id     text;
  v_schedule_id text;
  v_match_id    text;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id, active_match_id INTO v_schedule_id, v_match_id
  FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;

  IF v_match_id IS NOT NULL THEN

    INSERT INTO payment_ledger (team_id, player_id, match_id,
                                amount, type, status, method, paid_by, paid_at, note)
    SELECT v_team_id, pl.player_id, v_match_id,
           pl.amount, 'refund', 'refunded', 'admin', 'admin', now(), 'Match cancelled'
    FROM payment_ledger pl
    WHERE pl.match_id = v_match_id
      AND pl.team_id  = v_team_id
      AND pl.type     = 'game_fee'
      AND pl.status   = 'paid';

    UPDATE players p SET paid = false, self_paid = false, paid_by = null, paid_at = null
    FROM payment_ledger pl
    WHERE pl.match_id = v_match_id AND pl.team_id = v_team_id
      AND pl.type = 'game_fee' AND pl.status = 'paid'
      AND pl.player_id = p.id;

    INSERT INTO payment_ledger (team_id, player_id, match_id,
                                amount, type, status, method, paid_by, paid_at, note)
    SELECT v_team_id, pl.player_id, v_match_id,
           pl.amount, 'refund', 'refunded', 'admin', 'admin', now(), 'Match cancelled'
    FROM payment_ledger pl
    JOIN players p ON p.id = pl.player_id
    WHERE pl.match_id = v_match_id AND pl.team_id = v_team_id
      AND pl.type = 'game_fee' AND pl.status = 'unpaid'
      AND p.self_paid = true;

    UPDATE players p SET self_paid = false, paid_by = null, paid_at = null
    FROM payment_ledger pl
    WHERE pl.match_id = v_match_id AND pl.team_id = v_team_id
      AND pl.type = 'game_fee' AND pl.status = 'unpaid'
      AND pl.player_id = p.id AND p.self_paid = true;

    INSERT INTO payment_ledger (team_id, player_id, match_id, amount, type, status, note)
    SELECT v_team_id, tp.player_id, v_match_id, 0, 'cancelled', 'cancelled', 'Match cancelled'
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = v_team_id AND p.status = 'in';

    DELETE FROM player_match WHERE match_id = v_match_id AND team_id = v_team_id;

    UPDATE matches SET
      cancelled     = true,
      cancel_reason = p_cancel_reason
    WHERE id = v_match_id AND team_id = v_team_id;

  END IF;

  UPDATE players p SET
    status    = 'none',
    paid      = false,
    self_paid = false,
    paid_by   = null
  FROM team_players tp
  WHERE tp.team_id = v_team_id
    AND tp.player_id = p.id
    AND p.disabled = false;

  UPDATE schedule SET
    is_cancelled      = true,
    cancel_reason     = p_cancel_reason,
    game_is_live      = false,
    active_match_id   = null,
    auto_open_pending = true
  WHERE id = v_schedule_id AND team_id = v_team_id;

  PERFORM notify_team_change(v_team_id, 'match_cancelled');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'match_cancelled', 'match', COALESCE(v_match_id, v_schedule_id),
          jsonb_build_object('cancel_reason', p_cancel_reason,
                             'had_active_match', v_match_id IS NOT NULL));

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_cancel_match(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_cancel_match(text,text) TO authenticated, anon;
