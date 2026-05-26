-- =============================================================================
-- MIGRATION 082: admin_cancel_match clears admin_locked_in
-- =============================================================================
--
-- WHY: After a cancel, the bulk Step 5 reset cleared status/paid/self_paid/
-- paid_by but left players.admin_locked_in untouched. Any player who had been
-- admin-locked to 'in' at cancel time remained locked, so set_player_status
-- (the player's self-toggle RPC, mig 038) would refuse their next attempt to
-- self-mark in/out next week. Silent latent bug — caught on the 2026-05-26
-- Footy Tuesdays cancellation (Ranza, p_UG2K3Dwp).
--
-- FIX: Add `admin_locked_in = false` to the Step 5 SET list. Cancelling a
-- match releases every admin lock on the team — same semantics as resetting
-- status/paid.
--
-- SOURCE-OF-TRUTH NOTE: This file rewrites the LIVE body of admin_cancel_match
-- (retrieved via pg_get_functiondef on 2026-05-26). The on-disk mig 013 had
-- drifted — live had been upgraded to use resolve_admin_caller for VC/admin
-- parity. Mig 082 codifies the live body as well as adding the new column.
--
-- Rule 11: this source file lands in the same commit as apply_migration.
-- Rule 9 / mig 060 pattern: audit_events insert preserved (server-side trace
-- for the cancel action).
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
  -- Step 1: Validate admin token (resolves both team_admin and vice_captain)
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  -- Step 2: Get active schedule + active_match_id
  SELECT id, active_match_id INTO v_schedule_id, v_match_id
  FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;
  -- v_match_id may be NULL (game not yet started — cancel the schedule day only)

  -- Steps 3 & 4: Payment ledger processing (only when a match record exists)
  IF v_match_id IS NOT NULL THEN

    -- Step 4a: Refund entries for already-paid players
    INSERT INTO payment_ledger (team_id, player_id, match_id,
                                amount, type, status, method, paid_by, paid_at, note)
    SELECT v_team_id, pl.player_id, v_match_id,
           pl.amount, 'refund', 'refunded', 'admin', 'admin', now(), 'Match cancelled'
    FROM payment_ledger pl
    WHERE pl.match_id = v_match_id
      AND pl.team_id  = v_team_id
      AND pl.type     = 'game_fee'
      AND pl.status   = 'paid';

    -- Clear payment flags for those players
    UPDATE players p SET paid = false, self_paid = false, paid_by = null, paid_at = null
    FROM payment_ledger pl
    WHERE pl.match_id = v_match_id AND pl.team_id = v_team_id
      AND pl.type = 'game_fee' AND pl.status = 'paid'
      AND pl.player_id = p.id;

    -- Step 4b: Refund entries for self-paid-pending (unpaid + self_paid=true)
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

    -- Step 4c: Cancelled audit entries for all IN players (OI-52: needs CHECK update)
    INSERT INTO payment_ledger (team_id, player_id, match_id, amount, type, status, note)
    SELECT v_team_id, tp.player_id, v_match_id, 0, 'cancelled', 'cancelled', 'Match cancelled'
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = v_team_id AND p.status = 'in';

    -- Step 6: Delete player_match rows for this match
    DELETE FROM player_match WHERE match_id = v_match_id AND team_id = v_team_id;

    -- Step 7: Mark match as cancelled (OI-18: matches uses `cancelled`, not `is_cancelled`)
    UPDATE matches SET
      cancelled     = true,
      cancel_reason = p_cancel_reason
    WHERE id = v_match_id AND team_id = v_team_id;

  END IF;

  -- Step 5: Bulk reset player statuses for this team
  -- mig 082: also release every admin lock — cancellation invalidates them
  UPDATE players p SET
    status          = 'none',
    paid            = false,
    self_paid       = false,
    paid_by         = null,
    admin_locked_in = false
  FROM team_players tp
  WHERE tp.team_id = v_team_id
    AND tp.player_id = p.id
    AND p.disabled = false;

  -- Step 8: schedule — is_cancelled, game over, reset auto-open for next week (OI-18, OI-61)
  UPDATE schedule SET
    is_cancelled      = true,
    cancel_reason     = p_cancel_reason,
    game_is_live      = false,
    active_match_id   = null,
    auto_open_pending = true    -- OI-61: reset so advanceGameDateJob auto-opens next week
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
