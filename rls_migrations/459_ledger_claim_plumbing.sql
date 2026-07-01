-- 459: Ledger-claim plumbing (Per-Game Payment Marking, PR #1).
--
-- Lets a casual player mark an INDIVIDUAL game's fee as a CLAIM ("I say I've paid")
-- on the immutable payment_ledger row, awaiting admin confirmation — instead of the
-- vague whole-balance self_paid flag. The claim lives on the ledger row (not the
-- transient players.self_paid), so it SURVIVES the weekly go-live rollover (mig 243
-- resets self_paid but not ledger rows).
--
-- Additive only — two nullable columns; existing rows are byte-identical (claimed_at
-- NULL = "not claimed"). Nothing reads these columns until the UI ships (PR #3/#4/#5),
-- so this migration is DARK on apply.
--
--   claim_ledger_payment(p_token, p_ledger_id) → player stamps ONE unpaid game_fee row
--                          as claimed (claimed_at/claimed_by='self'); owes UNCHANGED,
--                          status stays 'unpaid'. The admin confirm (PR #2) is the money
--                          event. Idempotent (COALESCE); guarded to the caller's own
--                          team + player, type='game_fee', status='unpaid', match not
--                          cancelled.
--   admin_reject_claim(p_admin_token, p_player_id, p_ledger_id) → clears a false claim
--                          (claimed_at/claimed_by → NULL); status stays 'unpaid', owes
--                          untouched (the debt persists). Fills the gap where
--                          admin_reset_payment only undoes a CONFIRMED payment.
--   set_player_paid    → EXTENDED to ALSO stamp the current match's game_fee ledger row
--                          claimed (self), in the same transaction. Still does NOT
--                          change owes (claim stays pending, same as mig 211).
--   get_my_payment_history → return shape gains claimed_at/claimed_by (Hard Rule 12:
--                          matching dbToLedger mapper update lands in the same commit).

-- ── Schema: additive claim columns + partial index ───────────────────────────
ALTER TABLE public.payment_ledger
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS claimed_by text NULL
    CHECK (claimed_by IN ('self','host','admin'));

CREATE INDEX IF NOT EXISTS payment_ledger_claimed_idx
  ON public.payment_ledger (team_id, player_id, claimed_at DESC)
  WHERE claimed_at IS NOT NULL;

-- ── claim_ledger_payment: player marks ONE unpaid game_fee row as claimed ─────
CREATE OR REPLACE FUNCTION public.claim_ledger_payment(p_token text, p_ledger_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_match_id  text;
  v_amount    numeric;
  v_ledger    jsonb;
BEGIN
  IF p_token IS NULL OR p_ledger_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
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

  -- Guarded, idempotent stamp. The single WHERE clause enforces: the row belongs to
  -- THIS caller's player + team; is a game_fee (excludes guest_fee/debt_payment/etc.);
  -- is status='unpaid' (excludes paid/waived/cancelled/disputed/refunded); and its
  -- match (if any) is not cancelled. Never trusts a client-passed team/player/amount.
  UPDATE public.payment_ledger l
     SET claimed_at = COALESCE(l.claimed_at, now()),
         claimed_by = COALESCE(l.claimed_by, 'self'),
         updated_at = now()
   WHERE l.id        = p_ledger_id
     AND l.player_id = v_player_id
     AND l.team_id   = v_team_id
     AND l.type      = 'game_fee'
     AND l.status    = 'unpaid'
     AND NOT EXISTS (
       SELECT 1 FROM matches m WHERE m.id = l.match_id AND m.cancelled = true
     )
   RETURNING l.match_id, l.amount INTO v_match_id, v_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_claimable';
  END IF;

  -- Hard Rule 9: fire-and-forget player write leaves a server-side audit trace.
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'payment_ledger_claimed', 'payment_ledger', p_ledger_id::text,
    jsonb_build_object('ledger_id', p_ledger_id, 'match_id', v_match_id, 'amount', v_amount)
  );

  -- Hard Rule 10: reuse an already-whitelisted + subscribed reason string (mig 213);
  -- App.jsx's team_live broadcast subscriber refreshes squad on any broadcast.
  PERFORM notify_team_change(v_team_id, 'player_paid_updated');

  SELECT jsonb_build_object(
    'id', l.id, 'team_id', l.team_id, 'player_id', l.player_id, 'match_id', l.match_id,
    'amount', l.amount, 'type', l.type, 'status', l.status, 'method', l.method,
    'paid_by', l.paid_by, 'paid_at', l.paid_at, 'claimed_at', l.claimed_at,
    'claimed_by', l.claimed_by, 'note', l.note,
    'created_at', l.created_at, 'updated_at', l.updated_at
  ) INTO v_ledger FROM public.payment_ledger l WHERE l.id = p_ledger_id;

  RETURN jsonb_build_object('ok', true, 'ledger', v_ledger);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_ledger_payment(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_ledger_payment(text, uuid) TO anon, authenticated;

-- ── admin_reject_claim: admin clears a false claim; debt persists ─────────────
CREATE OR REPLACE FUNCTION public.admin_reject_claim(p_admin_token text, p_player_id text, p_ledger_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type  text;
  v_actor_ident text;
  v_team_id     text;
  v_match_id    text;
  v_ledger      jsonb;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'player_not_in_team';
  END IF;

  -- Team-scoped clear of the claim only. Leaves status='unpaid' and owes untouched —
  -- rejecting a claim means the debt was never settled, so it persists.
  -- Reject is a guarded action: the row must actually carry a claim. An unclaimed
  -- row raises claim_not_found rather than writing a spurious "rejection" audit.
  UPDATE public.payment_ledger l
     SET claimed_at = NULL,
         claimed_by = NULL,
         updated_at = now()
   WHERE l.id        = p_ledger_id
     AND l.player_id = p_player_id
     AND l.team_id   = v_team_id
     AND l.type      = 'game_fee'
     AND l.claimed_at IS NOT NULL
   RETURNING l.match_id INTO v_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'claim_not_found';
  END IF;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(), v_actor_ident,
    'payment_claim_rejected', 'payment_ledger', p_ledger_id::text,
    jsonb_build_object('ledger_id', p_ledger_id, 'player_id', p_player_id, 'match_id', v_match_id)
  );

  PERFORM notify_team_change(v_team_id, 'payment_reset');

  SELECT jsonb_build_object(
    'id', l.id, 'team_id', l.team_id, 'player_id', l.player_id, 'match_id', l.match_id,
    'amount', l.amount, 'type', l.type, 'status', l.status, 'method', l.method,
    'paid_by', l.paid_by, 'paid_at', l.paid_at, 'claimed_at', l.claimed_at,
    'claimed_by', l.claimed_by, 'note', l.note,
    'created_at', l.created_at, 'updated_at', l.updated_at
  ) INTO v_ledger FROM public.payment_ledger l WHERE l.id = p_ledger_id;

  RETURN jsonb_build_object('ok', true, 'ledger', v_ledger);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reject_claim(text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_reject_claim(text, text, uuid) TO anon, authenticated;

-- ── set_player_paid: EXTENDED to also stamp the current match's game_fee row ──
-- (Only additive vs mig 211: after flagging self_paid, stamp the current match's
--  unpaid game_fee ledger row as claimed. owes still UNCHANGED — claim stays pending.)
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

  -- 211: PENDING CLAIM only. Flag self_paid; do NOT clear owes.
  -- The debt stays outstanding until an admin confirms via admin_confirm_payment.
  UPDATE players
  SET    self_paid = true,
         paid_by   = 'self'
  WHERE  id = v_player_id;

  -- the existing unpaid game_fee charge for the current match (for return continuity)
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

  -- 459: also stamp that row as a per-week CLAIM (only if still unpaid + unclaimed),
  -- so the ledger-row claim survives the weekly rollover and drives the per-week UI.
  -- Does NOT touch owes — same pending-claim semantics as the whole-player flag above.
  IF v_ledger_id IS NOT NULL THEN
    -- v_ledger_id is text (returned as-is for continuity); payment_ledger.id is uuid.
    UPDATE payment_ledger
       SET claimed_at = COALESCE(claimed_at, now()),
           claimed_by = COALESCE(claimed_by, 'self'),
           updated_at = now()
     WHERE id       = v_ledger_id::uuid
       AND status   = 'unpaid'
       AND claimed_at IS NULL;
  END IF;

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

-- ── get_my_payment_history: return shape gains claimed_at / claimed_by ────────
CREATE OR REPLACE FUNCTION public.get_my_payment_history(
  p_token text,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_ledger    jsonb;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT p.id, tp.team_id
    INTO v_player_id, v_team_id
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token
   ORDER BY tp.created_at ASC
   LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',         pl.id,
      'team_id',    pl.team_id,
      'player_id',  pl.player_id,
      'match_id',   pl.match_id,
      'amount',     pl.amount,
      'type',       pl.type,
      'status',     pl.status,
      'method',     pl.method,
      'paid_by',    pl.paid_by,
      'paid_at',    pl.paid_at,
      'claimed_at', pl.claimed_at,
      'claimed_by', pl.claimed_by,
      'note',       pl.note,
      'created_at', pl.created_at,
      'updated_at', pl.updated_at
    ) ORDER BY pl.created_at DESC
  ) INTO v_ledger
  FROM (
    SELECT * FROM payment_ledger
    WHERE player_id = v_player_id
      AND team_id   = v_team_id
    ORDER BY created_at DESC
    LIMIT p_limit
  ) pl;

  RETURN COALESCE(v_ledger, '[]'::jsonb);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_payment_history(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_payment_history(text, integer) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
