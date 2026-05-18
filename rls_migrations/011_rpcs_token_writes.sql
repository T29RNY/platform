-- ============================================================
-- Migration 011: RPCs — token-based write functions
--   + notify_team_change internal helper (11 functions total)
-- Phase B: design-only; run in Phase C after 001–009 are applied
-- Depends on:
--   001_helpers.sql         — generate_url_safe_token (add_guest_player)
--   004b                    — team_players.created_at (ORDER BY in token validation)
--   008_rls_financial_audit — payment_ledger CHECK constraints
--   010_rpcs_token_reads    — players_by_token index (benefits write RPCs too)
-- ============================================================

-- ── DEPLOYMENT ORDER ─────────────────────────────────────────────────────────
-- Write RPCs bypass RLS (SECURITY DEFINER) so they work with or without
-- migrations 006–009. Apply 010 + 011 first, verify client writes work,
-- then apply 006–009. After 006–009, direct-table mutations from the client
-- stop; all writes route through these RPCs.
-- ── BROADCAST REASON STRINGS ─────────────────────────────────────────────────
-- All PERFORM notify_team_change(...) calls use Phase A §11.2 locked reason
-- values. The prompt-7 spec used informal names ('status_change', etc.) that
-- differ from the locked list; Phase A values are used here. See OI-37.
-- ── WRITE PATTERN ────────────────────────────────────────────────────────────
-- Every write RPC:
--   1. Validates null token → raises 'invalid_token'
--   2. Resolves token to (v_player_id, v_team_id) via JOIN with team_players
--   3. Raises 'invalid_token' if no row found
--   4. Performs domain validation → raises structured error code
--   5. Performs write(s)
--   6. Returns jsonb
--   7. EXCEPTION block re-raises P0001 errors as-is; wraps anything
--      else as 'internal_error' (opaque to client; logged to DB)
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- INTERNAL HELPER: notify_team_change
-- Emits a pg_notify signal to the team's live channel.
-- Called from write RPCs only; NOT callable by anon/authenticated directly.
-- Payload matches Phase A §11.2 locked broadcast format.
-- Migration 017 may wrap this further; this definition supersedes any
-- placeholder defined earlier in the migration sequence.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION notify_team_change(
  p_team_id text,
  p_reason  text
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel_key text;
  v_payload     text;
BEGIN
  IF p_team_id IS NULL THEN RETURN; END IF;

  SELECT live_channel_key
  INTO   v_channel_key
  FROM   teams
  WHERE  id = p_team_id;

  IF v_channel_key IS NULL THEN RETURN; END IF; -- no channel; silent no-op

  v_payload := jsonb_build_object(
    'type',   'team_state_changed',                    -- Phase A §11.2 locked
    'reason', COALESCE(p_reason, 'unspecified'),
    'at',     now()                                    -- ISO timestamptz in jsonb
  )::text;

  PERFORM pg_notify('team_live:' || v_channel_key, v_payload);
END;
$$;

REVOKE EXECUTE ON FUNCTION notify_team_change(text, text) FROM public;
-- No GRANT to anon/authenticated: internal use by SECURITY DEFINER RPCs only.


-- ════════════════════════════════════════════════════════════
-- FUNCTION 1: set_player_status
-- Sets players.status for the authenticated token-holder.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_player_status(
  p_token  text,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_result    jsonb;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Token validation: resolve to (player_id, team_id)
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

  -- Domain validation
  IF p_status IS NULL OR p_status NOT IN ('in','out','maybe','reserve','none') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status';
  END IF;

  UPDATE players
  SET    status = p_status
  WHERE  id     = v_player_id;

  -- Build §10.1 self-row response
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
    'is_vice_captain',p.is_vice_captain,
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
$$;

REVOKE EXECUTE ON FUNCTION set_player_status(text, text) FROM public;
GRANT  EXECUTE ON FUNCTION set_player_status(text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 2: set_player_paid
-- Player self-declares a cash payment. Sets players.self_paid=true
-- and creates/updates a payment_ledger entry with status='unpaid'
-- (pending admin confirmation). Does NOT set players.paid=true.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_player_paid(
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- Derive current match and price from active schedule
  SELECT s.active_match_id, s.price_per_player
    INTO v_match_id, v_price
    FROM schedule s
   WHERE s.team_id = v_team_id
     AND s.active  = true
   LIMIT 1;

  -- Read current debt before any updates
  SELECT COALESCE(owes, 0) INTO v_owes FROM players WHERE id = v_player_id;

  -- Update player self-payment flag
  UPDATE players
  SET    self_paid = true,
         paid_by   = 'self'
  WHERE  id = v_player_id;

  -- Clear any outstanding debt: insert a paid ledger entry and zero owes
  IF v_owes > 0 THEN
    INSERT INTO payment_ledger
      (team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at)
    VALUES
      (v_team_id, v_player_id, null, v_owes, 'debt_payment', 'paid', 'cash', 'self', now());
    UPDATE players SET owes = 0 WHERE id = v_player_id;
  END IF;

  -- Find-then-update ledger entry (mirrors findMatchLedgerEntry/createLedgerEntry
  -- in supabase.js). Handles null match_id (no lineup lock yet) via IS NULL branch.
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
    -- Idempotent: player may call set_player_paid again before admin confirms
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

  -- Build §10.1 response
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
    'is_vice_captain',p.is_vice_captain,
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
$$;

REVOKE EXECUTE ON FUNCTION set_player_paid(text) FROM public;
GRANT  EXECUTE ON FUNCTION set_player_paid(text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 3: set_player_injured
-- Player marks themselves injured (true) or recovered (false).
-- When marking injured and current status is 'in': auto-sets status='out'.
-- Mirrors insertPlayerInjury / clearPlayerInjury in supabase.js.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_player_injured(
  p_token   text,
  p_injured boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_result    jsonb;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_injured IS NULL THEN
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

  -- Single UPDATE handles injured flag, injured_since, and auto-out logic.
  -- status only changes to 'out' if currently 'in' and we are marking injured.
  UPDATE players
  SET    injured       = p_injured,
         injured_since = CASE WHEN p_injured     THEN now()  ELSE NULL END,
         status        = CASE WHEN p_injured AND status = 'in' THEN 'out'
                              ELSE status
                         END
  WHERE  id = v_player_id;

  -- Injury records (mirrors supabase.js insertPlayerInjury/clearPlayerInjury)
  IF p_injured THEN
    INSERT INTO player_injuries (id, player_id, team_id, injured_at, cleared_at, marked_by)
    VALUES ('inj_' || substr(gen_random_uuid()::text, 1, 12),
            v_player_id, v_team_id, now(), NULL, 'player');
  ELSE
    -- Clear the most recent open injury, matching clearPlayerInjury behaviour
    UPDATE player_injuries
    SET    cleared_at = now()
    WHERE  id = (
      SELECT id FROM player_injuries
      WHERE  player_id  = v_player_id
        AND  team_id    = v_team_id
        AND  cleared_at IS NULL
      ORDER BY injured_at DESC
      LIMIT 1
    );
  END IF;

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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p
  WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_injured_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION set_player_injured(text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION set_player_injured(text, boolean) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 4: add_guest_player
-- Host player adds a Plus One. Creates a new players row marked
-- is_guest=true, guest_of=v_player_id, with a generated token.
-- Note: existing addGuestPlayer (supabase.js) sets token=null and
-- type='regular'; this RPC generates a token (RLS requirement) and
-- keeps type='regular' to match existing records — see OI-38.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION add_guest_player(
  p_token      text,
  p_guest_name text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id   text;
  v_team_id     text;
  v_guest_id    text;
  v_guest_token text;
  v_result      jsonb;
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

  -- Domain validation: name required, max 50 chars
  IF p_guest_name IS NULL OR length(trim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;
  IF length(trim(p_guest_name)) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  -- Generate IDs (mirrors supabase.js 'p_' + random prefix pattern)
  v_guest_id    := generate_url_safe_token('p_', 6);
  v_guest_token := generate_url_safe_token('p_', 12);

  -- Insert guest player row (matches addGuestPlayer column set; type='regular'
  -- matches existing DB records — spec says 'cover', see OI-38)
  INSERT INTO players (
    id, name, token, type,
    disabled, priority, is_vice_captain,
    status, paid, owes,
    goals, motm, attended, total,
    bib_count, team, w, l, d,
    pay_count, late_dropouts, note, self_paid,
    is_guest, guest_of
  ) VALUES (
    v_guest_id, trim(p_guest_name), v_guest_token, 'regular',
    false, false, false,
    'in', false, 0,
    0, 0, 0, 0,
    0, null, 0, 0, 0,
    0, 0, '', false,
    true, v_player_id
  );

  -- Link guest to team
  INSERT INTO team_players (team_id, player_id)
  VALUES (v_team_id, v_guest_id);

  -- Return new guest player row (§10.1 shape — host sees full guest row)
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p
  WHERE p.id = v_guest_id;

  PERFORM notify_team_change(v_team_id, 'guest_player_added');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION add_guest_player(text, text) FROM public;
GRANT  EXECUTE ON FUNCTION add_guest_player(text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 5: set_guest_payment
-- Host marks their guest as paid (cash). The guest must exist,
-- be a guest, and be owned by the calling host.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_guest_payment(
  p_host_token text,
  p_guest_id   text,
  p_paid_by    text    -- 'self' (guest paid own) or 'host'
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_host_player_id text;
  v_team_id        text;
  v_match_id       text;
  v_price          numeric;
  v_ledger_id      text;
  v_guest_json     jsonb;
BEGIN
  IF p_host_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_paid_by IS NULL OR p_paid_by NOT IN ('self', 'host') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  -- Resolve host token
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

  -- Verify guest ownership: must exist, is_guest=true, guest_of=host
  IF NOT EXISTS (
    SELECT 1 FROM players
    WHERE  id       = p_guest_id
      AND  is_guest = true
      AND  guest_of = v_host_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  -- Get active match and price for ledger
  SELECT s.active_match_id, s.price_per_player
    INTO v_match_id, v_price
    FROM schedule s
   WHERE s.team_id = v_team_id
     AND s.active  = true
   LIMIT 1;

  -- Update guest self_paid flag
  UPDATE players
  SET    self_paid = true,
         paid_by   = p_paid_by
  WHERE  id = p_guest_id;

  -- Find-then-update guest fee ledger entry
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

  -- Return updated guest row (§10.1 shape)
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
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
$$;

REVOKE EXECUTE ON FUNCTION set_guest_payment(text, text, text) FROM public;
GRANT  EXECUTE ON FUNCTION set_guest_payment(text, text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 6: player_create_cash_payment_entry
-- DEPRECATED: thin wrapper around set_player_paid, retained for
-- compatibility with client call-sites during the Phase C refactor window.
-- Remove after all callers have been updated to call set_player_paid directly.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION player_create_cash_payment_entry(
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN set_player_paid(p_token);
END;
$$;

REVOKE EXECUTE ON FUNCTION player_create_cash_payment_entry(text) FROM public;
GRANT  EXECUTE ON FUNCTION player_create_cash_payment_entry(text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 7: register_push_subscription
-- Upserts a push subscription for the calling player.
-- One active subscription per player (UNIQUE on player_id).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION register_push_subscription(
  p_token        text,
  p_subscription jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_sub_id    text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Subscription must be a jsonb object with at least an 'endpoint' key
  IF p_subscription IS NULL OR NOT (p_subscription ? 'endpoint') THEN
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

  -- Upsert: one subscription per player. RETURNING id handles both insert
  -- (new sub_id) and update (existing id unchanged). Prefix matches supabase.js.
  INSERT INTO push_subscriptions (id, player_id, player_token, team_id, subscription)
  VALUES ('sub_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
          v_player_id, p_token, v_team_id, p_subscription)
  ON CONFLICT (player_id)
    DO UPDATE SET subscription  = EXCLUDED.subscription,
                  player_token  = EXCLUDED.player_token
  RETURNING id INTO v_sub_id;

  RETURN jsonb_build_object('ok', true, 'id', v_sub_id);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION register_push_subscription(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION register_push_subscription(text, jsonb) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 8: unregister_push_subscription
-- Removes the calling player's push subscription.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION unregister_push_subscription(
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
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

  DELETE FROM push_subscriptions
  WHERE  player_id = v_player_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION unregister_push_subscription(text) FROM public;
GRANT  EXECUTE ON FUNCTION unregister_push_subscription(text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 9: cast_potm_vote
-- Player casts a POTM vote for the currently-open vote window.
-- Relies on the UNIQUE (match_id, voter_id) constraint on potm_votes
-- as the authoritative duplicate guard — no pre-check SELECT.
-- Voter and nominee must both have attended=true in player_match.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cast_potm_vote(
  p_token      text,
  p_match_id   text,
  p_nominee_id text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_match_id IS NULL OR p_nominee_id IS NULL THEN
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

  -- Player cannot vote for themselves
  IF p_nominee_id = v_player_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ineligible_nominee';
  END IF;

  -- Match must exist for this team with voting currently open
  IF NOT EXISTS (
    SELECT 1 FROM matches
    WHERE  id           = p_match_id
      AND  team_id      = v_team_id
      AND  voting_open  = true
      AND  voting_closes_at > now()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'voting_closed';
  END IF;

  -- Caller must have attended the match
  IF NOT EXISTS (
    SELECT 1 FROM player_match
    WHERE  match_id  = p_match_id
      AND  player_id = v_player_id
      AND  attended  = true
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_attended';
  END IF;

  -- Nominee must have attended (and is not the caller, already checked above)
  IF NOT EXISTS (
    SELECT 1 FROM player_match
    WHERE  match_id  = p_match_id
      AND  player_id = p_nominee_id
      AND  attended  = true
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ineligible_nominee';
  END IF;

  -- Insert vote; unique_violation means duplicate → 'already_voted'
  INSERT INTO potm_votes (match_id, team_id, voter_id, nominee_id)
  VALUES (p_match_id, v_team_id, v_player_id, p_nominee_id);

  -- Increment vote counter (UPDATE serialises via row lock — race-safe)
  UPDATE matches
  SET    vote_count = COALESCE(vote_count, 0) + 1
  WHERE  id = p_match_id;

  PERFORM notify_team_change(v_team_id, 'potm_vote_cast'); -- extends Phase A §11.2 list; see OI-40

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_voted';
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION cast_potm_vote(text, text, text) FROM public;
GRANT  EXECUTE ON FUNCTION cast_potm_vote(text, text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 10: get_my_potm_vote
-- Returns the calling player's nominee for a given match, or null
-- if they haven't voted yet. Companion to cast_potm_vote.
-- Marked STABLE (read-only); raises on invalid token (write RPC pattern,
-- not silent-null, since it's co-located with cast_potm_vote).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_my_potm_vote(
  p_token    text,
  p_match_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id  text;
  v_nominee_id text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT id INTO v_player_id
  FROM   players
  WHERE  token = p_token;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT nominee_id
    INTO v_nominee_id
    FROM potm_votes
   WHERE match_id  = p_match_id
     AND voter_id  = v_player_id;

  -- Returns { nominee_id: "<id>" } or { nominee_id: null } — not-voted is not an error
  RETURN jsonb_build_object('nominee_id', v_nominee_id);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION get_my_potm_vote(text, text) FROM public;
GRANT  EXECUTE ON FUNCTION get_my_potm_vote(text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- POST-APPLY VERIFICATION (run manually)
-- ════════════════════════════════════════════════════════════

-- 1. All 11 functions exist; volatility correct:
-- SELECT proname,
--   CASE provolatile WHEN 'v' THEN 'VOLATILE' WHEN 's' THEN 'STABLE' END AS volatility,
--   prosecdef
-- FROM pg_proc
-- WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
--   AND proname IN (
--     'notify_team_change',
--     'set_player_status', 'set_player_paid', 'set_player_injured',
--     'add_guest_player', 'set_guest_payment',
--     'player_create_cash_payment_entry',
--     'register_push_subscription', 'unregister_push_subscription',
--     'cast_potm_vote', 'get_my_potm_vote'
--   )
-- ORDER BY proname;
-- Expected: 11 rows, prosecdef=true for all.
--   get_my_potm_vote → STABLE; all others → VOLATILE.

-- 2. Grants: notify_team_change has NO external grants; others have anon+authenticated:
-- SELECT routine_name, grantee
-- FROM information_schema.routine_privileges
-- WHERE routine_schema = 'public'
--   AND grantee IN ('anon', 'authenticated')
--   AND routine_name IN (
--     'notify_team_change',
--     'set_player_status', 'set_player_paid', 'set_player_injured',
--     'add_guest_player', 'set_guest_payment',
--     'player_create_cash_payment_entry',
--     'register_push_subscription', 'unregister_push_subscription',
--     'cast_potm_vote', 'get_my_potm_vote'
--   )
-- ORDER BY routine_name, grantee;
-- Expected: 20 rows (10 functions × 2 grantees). notify_team_change appears 0 times.

-- 3. Smoke tests as anon:
-- SET ROLE anon;
-- SELECT set_player_status('<token>', 'in');              -- jsonb §10.1 row
-- SELECT set_player_status('<token>', 'badstatus');       -- P0001: invalid_status
-- SELECT set_player_status('no_token', 'in');            -- P0001: invalid_token
-- SELECT set_player_status(null, 'in');                  -- P0001: invalid_token
-- SELECT add_guest_player('<token>', 'Ali');              -- jsonb guest row
-- SELECT add_guest_player('<token>', '');                 -- P0001: invalid_input
-- SELECT register_push_subscription('<token>', '{"endpoint":"https://example.com"}'); -- ok
-- SELECT register_push_subscription('<token>', '{}');    -- P0001: invalid_input
-- SELECT get_my_potm_vote('<token>', '<match_id>');       -- { nominee_id: null } or id
-- RESET ROLE;

-- 4. Verify cast_potm_vote immutability:
-- SELECT cast_potm_vote('<token>', '<match_id>', '<nominee_id>'); -- { ok: true }
-- SELECT cast_potm_vote('<token>', '<match_id>', '<other_id>');   -- P0001: already_voted

-- 5. notify_team_change blocked from external callers:
-- SET ROLE anon;
-- SELECT notify_team_change('team_demo', 'test'); -- ERROR: permission denied
-- RESET ROLE;

-- 6. player_create_cash_payment_entry delegates to set_player_paid:
-- SELECT player_create_cash_payment_entry('<token>');  -- same result as set_player_paid