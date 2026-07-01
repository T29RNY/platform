-- 460 DOWN: revert per-week settle. Restores admin_confirm_payment (owes = 0 whole-balance
-- zero) and admin_reset_payment (manual owes + amount restore) to their mig-211 bodies, and
-- drops the _recompute_player_owes helper. NOTE: after applying this down-migration, reconcile
-- owes from the ledger if any per-week settlement had already run (owes must not be left stale).

CREATE OR REPLACE FUNCTION public.admin_confirm_payment(p_admin_token text, p_player_id text, p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id   text;
  v_ledger_id uuid;
  v_price     int;
  v_player    jsonb;
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

  UPDATE players SET
    paid    = true,
    paid_by = COALESCE(paid_by, 'admin'),
    paid_at = now(),
    owes    = 0
  WHERE id = p_player_id;

  IF p_match_id IS NOT NULL AND p_match_id <> '' THEN
    SELECT id INTO v_ledger_id
    FROM payment_ledger
    WHERE player_id = p_player_id AND team_id = v_team_id
      AND type = 'game_fee' AND match_id = p_match_id
    LIMIT 1;
  ELSE
    SELECT id INTO v_ledger_id
    FROM payment_ledger
    WHERE player_id = p_player_id AND team_id = v_team_id
      AND type = 'game_fee' AND match_id IS NULL
    LIMIT 1;
  END IF;

  IF v_ledger_id IS NOT NULL THEN
    UPDATE payment_ledger SET
      status   = 'paid',
      method   = 'cash',
      paid_by  = COALESCE(paid_by, 'admin'),
      paid_at  = now(),
      match_id = COALESCE(NULLIF(p_match_id, ''), match_id)
    WHERE id = v_ledger_id;
  ELSE
    SELECT price_per_player INTO v_price
    FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;

    INSERT INTO payment_ledger
      (id, team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at)
    VALUES
      (gen_random_uuid(), v_team_id, p_player_id, NULLIF(p_match_id, ''),
       COALESCE(v_price, 0), 'game_fee', 'paid', 'cash', 'admin', now());
  END IF;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'player_paid_confirmed', 'player', p_player_id,
          jsonb_build_object('match_id', p_match_id));

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

CREATE OR REPLACE FUNCTION public.admin_reset_payment(p_admin_token text, p_player_id text, p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id   text;
  v_ledger_id uuid;
  v_amount    numeric;
  v_was_paid  boolean;
  v_player    jsonb;
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

  SELECT paid INTO v_was_paid FROM players WHERE id = p_player_id;

  IF p_match_id IS NOT NULL AND p_match_id <> '' THEN
    SELECT id, amount INTO v_ledger_id, v_amount
    FROM payment_ledger
    WHERE player_id = p_player_id AND team_id = v_team_id
      AND type = 'game_fee' AND match_id = p_match_id
    LIMIT 1;
  ELSE
    SELECT id, amount INTO v_ledger_id, v_amount
    FROM payment_ledger
    WHERE player_id = p_player_id AND team_id = v_team_id
      AND type = 'game_fee' AND match_id IS NULL
    LIMIT 1;
  END IF;

  UPDATE players SET
    paid      = false,
    self_paid = false,
    paid_by   = null,
    paid_at   = null
  WHERE id = p_player_id;

  IF v_was_paid = true AND v_amount IS NOT NULL THEN
    UPDATE players SET owes = COALESCE(owes, 0) + v_amount WHERE id = p_player_id;
  END IF;

  IF v_ledger_id IS NOT NULL THEN
    UPDATE payment_ledger SET
      status  = 'unpaid',
      method  = null,
      paid_by = null,
      paid_at = null
    WHERE id = v_ledger_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'player_paid_reset', 'player', p_player_id,
          jsonb_build_object('match_id', p_match_id, 'was_paid', v_was_paid,
                             'owes_restored', CASE WHEN v_was_paid THEN v_amount ELSE 0 END));

  PERFORM notify_team_change(v_team_id, 'payment_reset');

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

DROP FUNCTION IF EXISTS public._recompute_player_owes(text, text);

SELECT pg_notify('pgrst', 'reload schema');
