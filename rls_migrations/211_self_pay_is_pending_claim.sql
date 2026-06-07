-- 211: self-pay becomes a PENDING CLAIM; admin confirmation is what clears the debt.
--
-- Session-71 audit + operator decision: a player tapping "I've paid" (set_player_paid)
-- is a CLAIM awaiting admin confirmation, not a settled payment. Previously set_player_paid
-- zeroed `owes` and the admin's PaymentsScreen treated self_paid as fully paid — so a
-- claimer vanished from the outstanding list and the ledger-vs-owes totals disagreed.
--
-- Debt-clearing responsibility moves to the admin:
--   set_player_paid      → flags self_paid only; owes UNCHANGED, ledger untouched (claim).
--   admin_confirm_payment → marks paid, clears owes (the real money event), ledger → paid.
--   admin_reset_payment   → if undoing a CONFIRMED payment, restores owes by the charge
--                           amount; clears flags + ledger → unpaid. (Undoing a mere claim
--                           leaves owes alone — the debt was never cleared.)
--   set_guest_payment    → unchanged semantics (guests have no admin-confirm path, so a
--                           guest/host cash declaration stays "paid") + adds the missing
--                           audit_events row (HARD RULE 9, session-71 finding B2).
--
-- One-off: restore owes for any self-claimed-but-not-confirmed player whose owes was
-- wrongly zeroed by the old set_player_paid (= their unpaid game_fee total). Reconciles
-- Σ owes with the unpaid ledger (the live Bidz residue).

-- ── set_player_paid: claim only ──────────────────────────────────────────────
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

  SELECT s.active_match_id INTO v_match_id
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  -- 211: PENDING CLAIM only. Flag self_paid; do NOT clear owes or touch the ledger.
  -- The debt stays outstanding until an admin confirms via admin_confirm_payment.
  UPDATE players
  SET    self_paid = true,
         paid_by   = 'self'
  WHERE  id = v_player_id;

  -- read-only: the existing unpaid game_fee charge (for return-shape continuity)
  SELECT id INTO v_ledger_id
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

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_paid_self_declared', 'player', v_player_id,
    jsonb_build_object('match_id', v_match_id, 'ledger_id', v_ledger_id, 'kind', 'claim')
  );

  PERFORM notify_team_change(v_team_id, 'player_paid_updated');

  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname, 'status', p.status,
    'type', p.type, 'priority', p.priority, 'paid', p.paid, 'owes', p.owes,
    'self_paid', p.self_paid, 'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended, 'total', p.total,
    'w', p.w, 'l', p.l, 'd', p.d, 'bib_count', p.bib_count,
    'late_dropouts', p.late_dropouts, 'injured', p.injured, 'injured_since', p.injured_since,
    'is_guest', p.is_guest, 'guest_of', p.guest_of, 'note', p.note,
    'disabled', p.disabled, 'disable_reason', p.disable_reason, 'team', p.team
  ) INTO v_player_json FROM players p WHERE p.id = v_player_id;

  RETURN jsonb_build_object('player', v_player_json, 'ledger_id', v_ledger_id);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

-- ── admin_confirm_payment: now clears owes (the real money event) ────────────
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

  -- 211: confirmation is the real money event — mark paid AND clear the debt.
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

-- ── admin_reset_payment: restore owes when undoing a CONFIRMED payment ───────
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

  -- 211: only a CONFIRMED payment cleared the debt, so only it restores owes.
  -- Undoing a mere claim leaves owes untouched (the debt was never cleared).
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

-- ── set_guest_payment: add the missing audit row (B2); semantics unchanged ───
CREATE OR REPLACE FUNCTION public.set_guest_payment(p_host_token text, p_guest_id text, p_paid_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_host_player_id text;
  v_team_id        text;
  v_match_id       text;
  v_price          numeric;
  v_ledger_id      uuid;   -- 211: was text → uuid (payment_ledger.id is uuid; the old
                           -- text decl made the UPDATE branch `WHERE id = v_ledger_id`
                           -- raise uuid=text whenever a guest_fee row already existed —
                           -- a latent bug masked by the WHEN OTHERS catch).
  v_guest_json     jsonb;
BEGIN
  IF p_host_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_paid_by IS NULL OR p_paid_by NOT IN ('self', 'host') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_host_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_host_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_host_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM players
    WHERE  id       = p_guest_id
      AND  is_guest = true
      AND  guest_of = v_host_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  SELECT s.active_match_id, s.price_per_player
    INTO v_match_id, v_price
    FROM schedule s
   WHERE s.team_id = v_team_id
     AND s.active  = true
   LIMIT 1;

  UPDATE players
  SET    self_paid = true,
         paid_by   = p_paid_by
  WHERE  id = p_guest_id;

  SELECT id
    INTO v_ledger_id
    FROM payment_ledger
   WHERE player_id = p_guest_id
     AND team_id   = v_team_id
     AND type      = 'guest_fee'
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
           paid_by = p_paid_by
    WHERE  id = v_ledger_id;
  ELSE
    INSERT INTO payment_ledger
      (team_id, player_id, match_id, amount, type, status, method, paid_by)
    VALUES
      (v_team_id, p_guest_id, v_match_id, COALESCE(v_price, 0), 'guest_fee', 'unpaid', 'cash', p_paid_by)
    RETURNING id INTO v_ledger_id;
  END IF;

  -- 211 (HARD RULE 9): audit the guest payment declaration. actor is the host.
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_host_token),
    'guest_payment_set', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_host_player_id, 'paid_by', p_paid_by,
                       'ledger_id', v_ledger_id, 'match_id', v_match_id)
  );

  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname, 'status', p.status,
    'type', p.type, 'priority', p.priority, 'paid', p.paid, 'owes', p.owes,
    'self_paid', p.self_paid, 'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended, 'total', p.total,
    'w', p.w, 'l', p.l, 'd', p.d, 'bib_count', p.bib_count,
    'late_dropouts', p.late_dropouts, 'injured', p.injured, 'injured_since', p.injured_since,
    'is_guest', p.is_guest, 'guest_of', p.guest_of, 'note', p.note,
    'disabled', p.disabled, 'disable_reason', p.disable_reason, 'team', p.team
  )
  INTO v_guest_json
  FROM players p
  WHERE p.id = p_guest_id;

  PERFORM notify_team_change(v_team_id, 'guest_payment_updated');

  RETURN jsonb_build_object(
    'player',    v_guest_json,
    'ledger_id', v_ledger_id
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

-- ── One-off reconciliation: a confirmed-paid player (paid=true, owes=0) that still
--    carries a stale UNPAID game_fee ledger row — mark the row paid so Σ owes and the
--    unpaid-ledger total agree. (Live residue: Bidz p_4ef07e08 — old self-pay zeroed
--    owes and admin-confirm set paid=true, but a stale unpaid game_fee row was left
--    behind, producing the £45-owes vs £50-ledger gap.) owes=0 guarantees the player
--    has no outstanding debt, so any lingering unpaid game_fee is stale. ──
UPDATE payment_ledger l
SET    status  = 'paid',
       method  = 'cash',
       paid_by = COALESCE(l.paid_by, p.paid_by, 'admin'),
       paid_at = COALESCE(l.paid_at, now())
FROM   players p
WHERE  l.player_id = p.id
  AND  l.type = 'game_fee' AND l.status = 'unpaid'
  AND  p.paid = true AND COALESCE(p.owes, 0) = 0;

SELECT pg_notify('pgrst', 'reload schema');
