-- 460: Per-week settle via owes-recompute (Per-Game Payment Marking, PR #2).
--
-- The money-invariant change. `players.owes` stops being an arithmetic accumulator
-- (owes = owes ± amount) and becomes a value RECOMPUTED from the ledger:
--     owes = SUM(amount) WHERE type='game_fee' AND status='unpaid'
-- called at the end of every settlement RPC. This is self-healing and eliminates the
-- drift / double-subtract / negative-owes hazards of arithmetic mutation.
--
-- ⚠️ NOT DARK. The instant this is applied, admin_confirm_payment stops zeroing the
-- whole balance and instead settles ONLY the confirmed week, recomputing owes from the
-- remaining unpaid game_fee rows. For a one-unpaid-week player the result is identical
-- (owes → 0); for a multi-week debtor it is the (correct) per-week result.
--
-- PRECONDITION (must hold at apply): owes == SUM(unpaid game_fee) for every live player.
-- Any drifted player would see owes jump to the ledger figure on their next confirm/reset.
-- Verify + reconcile drift BEFORE applying (see PR #2 precondition in the manifest).
--
--   _recompute_player_owes(player, team) → internal helper; sets owes = Σ unpaid game_fee.
--   admin_confirm_payment → settle THIS match's row (idempotent), recompute owes,
--                           set paid = (owes = 0). Replaces the old owes = 0.
--   admin_reset_payment   → flip THIS match's row back to unpaid, recompute owes
--                           (self-healing; replaces the manual owes + amount restore),
--                           set paid = (owes = 0).

-- ── helper: recompute owes from the ledger (single source of truth) ──────────
CREATE OR REPLACE FUNCTION public._recompute_player_owes(p_player_id text, p_team_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- owes is a per-PLAYER total across ALL the player's teams (result-save has always
  -- accumulated `owes += price` into this single global column regardless of team, and
  -- the one-off snap below is likewise cross-team). So the recompute is intentionally
  -- NOT filtered by p_team_id — filtering by team would make a two-team player's owes
  -- silently drop the other team's unpaid fees on the next confirm/reset. p_team_id is
  -- retained for call-site symmetry with the settlement RPCs.
  UPDATE players
     SET owes = COALESCE((
           SELECT SUM(l.amount)
           FROM payment_ledger l
           WHERE l.player_id = p_player_id
             AND l.type      = 'game_fee'
             AND l.status    = 'unpaid'
         ), 0)
   WHERE id = p_player_id;
END;
$function$;

-- internal helper only — never client-callable (called from within SECDEF RPCs).
-- Must REVOKE from the NAMED roles, not just PUBLIC: the project's ALTER DEFAULT
-- PRIVILEGES auto-grants anon+authenticated EXECUTE on every new function, and a bare
-- REVOKE FROM public does not remove those named grants.
REVOKE ALL ON FUNCTION public._recompute_player_owes(text, text) FROM public, anon, authenticated;

-- ── admin_confirm_payment: per-week settle + owes recompute ──────────────────
CREATE OR REPLACE FUNCTION public.admin_confirm_payment(p_admin_token text, p_player_id text, p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  -- Locate THIS match's game_fee row (or the whole-balance NULL-match row).
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
    -- Settle ONLY if still unpaid — idempotent, no double-settle. Preserves
    -- claimed_at/claimed_by (a settled row keeps the record it was claimed).
    UPDATE payment_ledger SET
      status   = 'paid',
      method   = 'cash',
      paid_by  = COALESCE(paid_by, 'admin'),
      paid_at  = now(),
      match_id = COALESCE(NULLIF(p_match_id, ''), match_id)
    WHERE id = v_ledger_id
      AND status = 'unpaid';
  ELSE
    -- No ledger row for this match — record a paid one (does not affect the owes
    -- recompute, which sums only UNPAID rows).
    SELECT price_per_player INTO v_price
    FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;

    INSERT INTO payment_ledger
      (id, team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at)
    VALUES
      (gen_random_uuid(), v_team_id, p_player_id, NULLIF(p_match_id, ''),
       COALESCE(v_price, 0), 'game_fee', 'paid', 'cash', 'admin', now());
  END IF;

  -- 460: owes is now RECOMPUTED from the remaining unpaid game_fee rows — settling
  -- one week drops owes by exactly that week, leaving other weeks outstanding.
  PERFORM _recompute_player_owes(p_player_id, v_team_id);

  -- paid reflects full settlement: true iff nothing is still owed.
  UPDATE players SET
    paid    = (owes = 0),
    paid_by = COALESCE(paid_by, 'admin'),
    paid_at = CASE WHEN owes = 0 THEN now() ELSE paid_at END
  WHERE id = p_player_id;

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

-- ── admin_reset_payment: undo one week's settlement + owes recompute ─────────
CREATE OR REPLACE FUNCTION public.admin_reset_payment(p_admin_token text, p_player_id text, p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id   text;
  v_ledger_id uuid;
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

  UPDATE players SET
    self_paid = false,
    paid_by   = null
  WHERE id = p_player_id;

  IF v_ledger_id IS NOT NULL THEN
    UPDATE payment_ledger SET
      status  = 'unpaid',
      method  = null,
      paid_by = null,
      paid_at = null
    WHERE id = v_ledger_id;
  END IF;

  -- 460: recompute owes from the ledger — flipping this week back to unpaid restores
  -- exactly its amount (self-healing; replaces the manual owes + amount arithmetic).
  PERFORM _recompute_player_owes(p_player_id, v_team_id);

  UPDATE players SET
    paid    = (owes = 0),
    paid_at = CASE WHEN owes = 0 THEN paid_at ELSE null END
  WHERE id = p_player_id;

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'player_paid_reset', 'player', p_player_id,
          jsonb_build_object('match_id', p_match_id, 'was_paid', v_was_paid));

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

-- ── One-off owes reconciliation (PR #2, operator-approved 2026-07-01) ─────────
-- owes becomes ledger-recomputed below, so it must equal Σ(unpaid game_fee) for every
-- live player at apply. A pre-apply reconciliation check found exactly 2 drifted players
-- on team_KPaoX8oJYMQ (the other 86 player-team rows already matched):
--   • rockybram (p_cQ-NpVz55ng): a game_fee charge for the FUTURE m_yPC1PEKrwkA (Jul-7)
--     game was raised before it was played. Void it — result-save re-creates the per-
--     attendee row when the game is actually played. Brings his ledger to £5 (= his owes).
--   • Rohan (p_5eacbc1c): owes (£10) under-counted his 3 genuinely-unpaid PLAYED games
--     (Jun 2/16/30 = £15). The snap corrects him UP to the ledger figure (£15).
-- Simulated against live data: after the void, the snap moves ONLY Rohan (10→15).
DELETE FROM payment_ledger
 WHERE player_id = 'p_cQ-NpVz55ng' AND team_id = 'team_KPaoX8oJYMQ'
   AND match_id = 'm_yPC1PEKrwkA' AND type = 'game_fee' AND status = 'unpaid';

UPDATE players p
   SET owes = COALESCE((
         SELECT SUM(l.amount) FROM payment_ledger l
         WHERE l.player_id = p.id AND l.type = 'game_fee' AND l.status = 'unpaid'
       ), 0);

SELECT pg_notify('pgrst', 'reload schema');
