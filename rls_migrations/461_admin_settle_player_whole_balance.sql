-- 461: admin_settle_player — settle a player's WHOLE outstanding casual balance.
--
-- Fix for a regression the per-game payment epic introduced. The admin's player-level
-- "claims paid · CONFIRM" (and the "Confirm payment" menu item) called
-- admin_confirm_payment(ACTIVE match). Pre-mig-460 that zeroed the whole balance, so it
-- "worked"; post-mig-460 confirm settles ONE week, and for a player whose debt is on
-- EARLIER weeks (not the active, often-unplayed match) it settles nothing — and
-- admin_confirm_payment's ELSE branch inserts a spurious paid row on the unplayed active
-- match. Net effect the operator saw: "tapping confirm does nothing, it reappears."
--
-- This RPC is the whole-player confirm: mark EVERY unpaid game_fee week paid, recompute
-- owes (→ 0), set paid=true. Per-week precision stays in admin_confirm_payment(matchId)
-- via the expanded-ledger Confirm/Reject buttons (PR #5).

CREATE OR REPLACE FUNCTION public.admin_settle_player(p_admin_token text, p_player_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id text;
  v_count int;
  v_player jsonb;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_not_in_team';
  END IF;

  -- Settle every unpaid game_fee week for this player on this team.
  UPDATE payment_ledger SET
    status  = 'paid',
    method  = 'cash',
    paid_by = COALESCE(paid_by, 'admin'),
    paid_at = now()
  WHERE player_id = p_player_id AND team_id = v_team_id
    AND type = 'game_fee' AND status = 'unpaid';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- owes recomputes from the (now zero) unpaid rows; whole balance settled → paid.
  PERFORM _recompute_player_owes(p_player_id, v_team_id);
  UPDATE players SET
    paid    = true,
    paid_by = COALESCE(paid_by, 'admin'),
    paid_at = now()
  WHERE id = p_player_id;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'player_paid_confirmed', 'player', p_player_id,
          jsonb_build_object('mode', 'settle_all', 'weeks_settled', v_count));

  PERFORM notify_team_change(v_team_id, 'payment_confirmed');

  SELECT jsonb_build_object(
    'id', id, 'name', name, 'nickname', nickname, 'status', status,
    'type', type, 'priority', priority, 'paid', paid, 'owes', owes,
    'self_paid', self_paid, 'paid_by', paid_by, 'pay_count', pay_count,
    'goals', goals, 'motm', motm, 'attended', attended, 'total', total,
    'w', w, 'l', l, 'd', d, 'bib_count', bib_count,
    'late_dropouts', late_dropouts, 'injured', injured, 'injured_since', injured_since,
    'is_guest', is_guest, 'guest_of', guest_of, 'note', note,
    'disabled', disabled, 'disable_reason', disable_reason, 'team', team
  ) INTO v_player FROM players WHERE id = p_player_id;

  RETURN jsonb_build_object('ok', true, 'player', v_player);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_settle_player(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_settle_player(text, text) TO anon, authenticated;

-- One-off cleanup: remove the phantom paid game_fee row on the UNPLAYED active match
-- m_yPC1PEKrwkA that the pre-fix confirm taps inserted for Tarny (p_b24c5bf8). Deleting it
-- lets result-save re-charge the game normally when it is actually played (NOT EXISTS guard).
DELETE FROM payment_ledger WHERE id = '84e6b722-982f-4cb6-9cb2-df696fbe9c40';

SELECT pg_notify('pgrst', 'reload schema');
