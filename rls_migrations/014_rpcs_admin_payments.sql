-- ============================================================
-- Migration 014: Admin payment RPCs
-- Phase B (design only — DO NOT EXECUTE)
-- ============================================================
-- Depends on:
--   003_audit_events.sql
--   008_rls_financial_audit.sql   — payment_ledger RLS + CHECK constraints
--   011_rpcs_token_writes.sql     — notify_team_change
--   013_rpcs_admin_match_schedule.sql — admin token pattern established
--
-- Functions:
--   1. admin_confirm_payment   — confirm player's cash payment
--   2. admin_reset_payment     — reset player's payment state
--   3. admin_clear_debt        — player paid their outstanding debt
--   4. admin_waive_debt        — write off player's outstanding debt
--
-- Broadcast reasons (§11.2 locked): payment_confirmed, payment_reset,
--   debt_cleared, debt_waived.
-- Note: audit action names use 'player_' prefix (not §11.2 broadcast reasons).
-- ============================================================


-- ── Shared player-row SELECT helper (§10.1/§10.3 column set, 29 cols) ─────────
-- Used inline at end of each function after mutation.
-- Excludes: token, user_id, paid_at, role_scope, created_at.


-- ── 1. admin_confirm_payment ────────────────────────────────────────────────────
-- Confirms a player's cash payment. Mirrors handleMarkPaid in payments.js.
-- find-then-update on payment_ledger; promotes null match_id → real match_id
-- if the ledger entry predates lineup lock (cross-path promotion).
-- p_match_id is nullable: null for pre-lineup-lock payments.

CREATE OR REPLACE FUNCTION admin_confirm_payment(
  p_admin_token text,
  p_player_id   text,
  p_match_id    text    -- nullable
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id   text;
  v_ledger_id uuid;
  v_price     int;
  v_player    jsonb;
BEGIN
  -- Validate admin + player-in-team
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_not_in_team';
  END IF;

  -- Update player payment state
  UPDATE players SET
    paid    = true,
    paid_by = COALESCE(paid_by, 'admin'),
    paid_at = now()
  WHERE id = p_player_id;

  -- Find existing ledger entry (handles both null and non-null match_id paths)
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
    -- Update existing entry; promote null match_id → real match_id if known now
    UPDATE payment_ledger SET
      status   = 'paid',
      method   = 'cash',
      paid_by  = COALESCE(paid_by, 'admin'),
      paid_at  = now(),
      match_id = COALESCE(NULLIF(p_match_id, ''), match_id)
    WHERE id = v_ledger_id;
  ELSE
    -- No existing entry — create one (edge case: payment before ledger entry created)
    SELECT price_per_player INTO v_price
    FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;

    INSERT INTO payment_ledger
      (id, team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at)
    VALUES
      (gen_random_uuid(), v_team_id, p_player_id, NULLIF(p_match_id, ''),
       COALESCE(v_price, 0), 'game_fee', 'paid', 'cash', 'admin', now());
  END IF;

  -- Audit
  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'player_paid_confirmed', 'player', p_player_id,
          jsonb_build_object('match_id', p_match_id));

  -- Broadcast (§11.2: 'payment_confirmed')
  PERFORM notify_team_change(v_team_id, 'payment_confirmed');

  -- Return updated player row (§10.3)
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'nickname', nickname, 'status', status,
    'type', type, 'priority', priority, 'paid', paid, 'owes', owes,
    'self_paid', self_paid, 'paid_by', paid_by, 'pay_count', pay_count,
    'goals', goals, 'motm', motm, 'attended', attended, 'total', total,
    'w', w, 'l', l, 'd', d, 'bib_count', bib_count,
    'late_dropouts', late_dropouts, 'injured', injured, 'injured_since', injured_since,
    'is_guest', is_guest, 'guest_of', guest_of, 'note', note,
    'disabled', disabled,
    'disable_reason', disable_reason, 'team', team
  ) INTO v_player FROM players WHERE id = p_player_id;

  RETURN jsonb_build_object('ok', true, 'player', v_player);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_confirm_payment(text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_confirm_payment(text,text,text) TO authenticated, anon;


-- ── 2. admin_reset_payment ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_reset_payment(
  p_admin_token text,
  p_player_id   text,
  p_match_id    text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id   text;
  v_ledger_id uuid;
  v_player    jsonb;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_not_in_team';
  END IF;

  UPDATE players SET
    paid      = false,
    self_paid = false,
    paid_by   = null,
    paid_at   = null
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
      status  = 'unpaid',
      method  = null,
      paid_by = null,
      paid_at = null
    WHERE id = v_ledger_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'player_paid_reset', 'player', p_player_id,
          jsonb_build_object('match_id', p_match_id));

  PERFORM notify_team_change(v_team_id, 'payment_reset');

  SELECT jsonb_build_object(
    'id', id, 'name', name, 'nickname', nickname, 'status', status,
    'type', type, 'priority', priority, 'paid', paid, 'owes', owes,
    'self_paid', self_paid, 'paid_by', paid_by, 'pay_count', pay_count,
    'goals', goals, 'motm', motm, 'attended', attended, 'total', total,
    'w', w, 'l', l, 'd', d, 'bib_count', bib_count,
    'late_dropouts', late_dropouts, 'injured', injured, 'injured_since', injured_since,
    'is_guest', is_guest, 'guest_of', guest_of, 'note', note,
    'disabled', disabled,
    'disable_reason', disable_reason, 'team', team
  ) INTO v_player FROM players WHERE id = p_player_id;

  RETURN jsonb_build_object('ok', true, 'player', v_player);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_reset_payment(text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_reset_payment(text,text,text) TO authenticated, anon;


-- ── 3. admin_clear_debt ─────────────────────────────────────────────────────────
-- Player paid their outstanding debt. Zeroes owes and creates a debt_payment
-- ledger entry. match_id=null — debt payments are not match-specific.

CREATE OR REPLACE FUNCTION admin_clear_debt(
  p_admin_token text,
  p_player_id   text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
  v_owes    int := 0;
  v_player  jsonb;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_not_in_team';
  END IF;

  SELECT COALESCE(owes, 0) INTO v_owes FROM players WHERE id = p_player_id;

  UPDATE players SET owes = 0 WHERE id = p_player_id;

  INSERT INTO payment_ledger
    (id, team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at)
  VALUES
    (gen_random_uuid(), v_team_id, p_player_id, null,
     v_owes, 'debt_payment', 'paid', 'cash', 'self', now());

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'player_debt_cleared', 'player', p_player_id,
          jsonb_build_object('amount_cleared', v_owes));

  PERFORM notify_team_change(v_team_id, 'debt_cleared');

  SELECT jsonb_build_object(
    'id', id, 'name', name, 'nickname', nickname, 'status', status,
    'type', type, 'priority', priority, 'paid', paid, 'owes', owes,
    'self_paid', self_paid, 'paid_by', paid_by, 'pay_count', pay_count,
    'goals', goals, 'motm', motm, 'attended', attended, 'total', total,
    'w', w, 'l', l, 'd', d, 'bib_count', bib_count,
    'late_dropouts', late_dropouts, 'injured', injured, 'injured_since', injured_since,
    'is_guest', is_guest, 'guest_of', guest_of, 'note', note,
    'disabled', disabled,
    'disable_reason', disable_reason, 'team', team
  ) INTO v_player FROM players WHERE id = p_player_id;

  RETURN jsonb_build_object('ok', true, 'player', v_player);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_clear_debt(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_clear_debt(text,text) TO authenticated, anon;


-- ── 4. admin_waive_debt ─────────────────────────────────────────────────────────
-- Writes off a player's outstanding debt. No payment required.

CREATE OR REPLACE FUNCTION admin_waive_debt(
  p_admin_token text,
  p_player_id   text,
  p_note        text DEFAULT null
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
  v_owes    int := 0;
  v_player  jsonb;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_not_in_team';
  END IF;

  SELECT COALESCE(owes, 0) INTO v_owes FROM players WHERE id = p_player_id;

  UPDATE players SET owes = 0 WHERE id = p_player_id;

  INSERT INTO payment_ledger
    (id, team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at, note)
  VALUES
    (gen_random_uuid(), v_team_id, p_player_id, null,
     v_owes, 'waiver', 'waived', 'admin', 'admin', now(), p_note);

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'player_debt_waived', 'player', p_player_id,
          jsonb_build_object('amount_waived', v_owes, 'note', p_note));

  PERFORM notify_team_change(v_team_id, 'debt_waived');

  SELECT jsonb_build_object(
    'id', id, 'name', name, 'nickname', nickname, 'status', status,
    'type', type, 'priority', priority, 'paid', paid, 'owes', owes,
    'self_paid', self_paid, 'paid_by', paid_by, 'pay_count', pay_count,
    'goals', goals, 'motm', motm, 'attended', attended, 'total', total,
    'w', w, 'l', l, 'd', d, 'bib_count', bib_count,
    'late_dropouts', late_dropouts, 'injured', injured, 'injured_since', injured_since,
    'is_guest', is_guest, 'guest_of', guest_of, 'note', note,
    'disabled', disabled,
    'disable_reason', disable_reason, 'team', team
  ) INTO v_player FROM players WHERE id = p_player_id;

  RETURN jsonb_build_object('ok', true, 'player', v_player);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_waive_debt(text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_waive_debt(text,text,text) TO authenticated, anon;


-- ── Verification queries (commented out) ────────────────────────────────────────
-- SELECT proname, prosecdef FROM pg_proc
-- WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
--   AND proname IN ('admin_confirm_payment','admin_reset_payment',
--                  'admin_clear_debt','admin_waive_debt');
-- Expected: 4 rows, prosecdef=true.
--
-- SELECT admin_confirm_payment('<admin_token>', '<player_id>', null);
-- → { ok: true, player: { paid: true, ... } }
-- SELECT admin_clear_debt('<admin_token>', '<player_with_owes>');
-- → { ok: true, player: { owes: 0, ... } }
-- SELECT * FROM payment_ledger WHERE player_id='<player_id>'
--   ORDER BY created_at DESC LIMIT 3;
-- → audit trail: game_fee + debt_payment entries visible