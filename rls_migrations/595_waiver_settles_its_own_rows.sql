-- 595: a waiver must settle the games it forgives. Closes the resurrect-on-confirm trap.
--
-- THE BUG (live, pre-dates this epic, found by the operator staring at his own ledger):
-- admin_waive_debt forgave a debt by zeroing players.owes and writing a 'waiver' marker row —
-- and LEAVING the forgiven game_fee rows status='unpaid' forever. So the write-off lived in
-- exactly one place: the owes cache. Any recompute blew it away.
--
-- That made a completely ordinary action destructive: admin_confirm_payment calls
-- _recompute_player_owes, which sums unpaid game_fee. So marking ONE week paid for a player
-- whose debt you'd forgiven resurrected the rest of it. On the operator's squad, 8 players
-- were one tap from having their write-off undone (Karan £30 across 6 games → tap any one and
-- £25 comes back). His ledger showed a "£30 WAIVED" line sitting directly above six UNPAID
-- rows each with a "Mark paid" button: the same £30, twice, with a trap attached.
--
-- THREE PARTS, one migration, applied atomically because they only make sense together:
--
-- 1. BACKFILL the 31 already-forgiven rows → status='waived'. Verified unambiguous first:
--    every waiver's amount EXACTLY equals the sum of that (team, player)'s unpaid game_fee
--    rows created BEFORE the waiver, and NOBODY has played since being waived (0.00 unpaid
--    after every waiver timestamp). So "all their unpaid game_fee rows before the waiver" is
--    exact, not a guess. The `created_at < waived_at` bound is kept anyway — it is what makes
--    this correct for a player who plays again later.
--
-- 2. admin_waive_debt now settles the rows it forgives, and RECOMPUTES owes instead of zeroing
--    it. The old `UPDATE players SET owes = 0` was a second, quieter bug: owes is deliberately
--    CROSS-TEAM (mig 460:33-38), so waiving on team A silently wiped the player's team B debt
--    too. Marking this team's rows + recomputing is correct for both teams.
--
-- 3. _team_debtors DROPS mig 592's waiver subtraction. 592 subtracted waivers because the
--    ledger couldn't describe itself; now it can — waived rows fail the status='unpaid' filter
--    and never enter the sum. Leaving both would DOUBLE-COUNT: waive £30, play 2 more games →
--    debt=10, waived=30, owed=-20 → the player vanishes instead of owing £10. 592 was a
--    workaround; this removes the thing it worked around, so the workaround must go with it.
--
-- NET EFFECT: the ledger becomes self-describing. A forgiven game says 'waived' and shows no
-- Mark-paid button; every reader (the chase, the cron, the Gaffer, _recompute_player_owes,
-- admin_confirm_payment) gets the right answer with no compensating arithmetic, and no future
-- reader can make this mistake.

-- ── 1. Backfill the already-forgiven rows ────────────────────────────────────
UPDATE payment_ledger l
   SET status     = 'waived',
       method     = COALESCE(l.method, 'admin'),
       paid_by    = COALESCE(l.paid_by, 'admin'),
       paid_at    = COALESCE(l.paid_at, w.created_at),
       note       = COALESCE(l.note, 'settled by waiver ' || w.id::text || ' (mig 595 backfill)'),
       updated_at = now()
  FROM payment_ledger w
 WHERE w.type      = 'waiver'
   AND w.status    = 'waived'
   AND l.player_id = w.player_id
   AND l.team_id   = w.team_id
   AND l.type      = 'game_fee'
   AND l.status    = 'unpaid'
   AND l.created_at < w.created_at;

-- ── 2. _team_debtors: drop the (now double-counting) waiver subtraction ──────
CREATE OR REPLACE FUNCTION public._team_debtors(p_team_id text)
RETURNS TABLE (
  player_id      text,
  owed           numeric,
  has_push       boolean,
  has_email      boolean,
  has_phone      boolean,
  last_chased_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH transport AS (
    SELECT COALESCE((SELECT pc.push_transport_live FROM platform_config pc LIMIT 1), false) AS push_live
  ),
  -- Waived rows now carry status='waived' (mig 595), so this status='unpaid' filter excludes
  -- them on its own. mig 592's explicit `- SUM(waived)` is GONE: with self-describing rows it
  -- would subtract the same money twice and hide a player who owes for games played AFTER a
  -- waiver.
  debt AS (
    SELECT COALESCE(g.guest_of, l.player_id) AS target_id,
           l.amount,
           l.claimed_at
      FROM payment_ledger l
      JOIN players g ON g.id = l.player_id
     WHERE l.team_id = p_team_id
       AND l.status  = 'unpaid'
       AND (
             (l.type = 'game_fee'  AND COALESCE(g.is_guest, false) = false)
          OR (l.type = 'guest_fee' AND g.guest_of IS NOT NULL)
           )
  ),
  agg AS (
    SELECT d.target_id,
           SUM(d.amount)                     AS owed,
           bool_or(d.claimed_at IS NOT NULL) AS any_claimed
      FROM debt d
     GROUP BY d.target_id
  )
  SELECT
    p.id AS player_id,
    a.owed,
    (EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.player_id = p.id)
       AND (SELECT push_live FROM transport))            AS has_push,
    (p.user_id IS NOT NULL)                              AS has_email,
    (p.phone   IS NOT NULL)                              AS has_phone,
    (SELECT max(nl.sent_at)
       FROM notification_log nl
      WHERE nl.team_id   = p_team_id
        AND nl.player_id = p.id
        AND nl.type      = 'adminChasePayment'
        AND nl.sent_at IS NOT NULL)                      AS last_chased_at
  FROM agg a
  JOIN players p       ON p.id = a.target_id
  JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = p_team_id
 WHERE a.owed > 0
   AND COALESCE(p.disabled, false) = false
   AND COALESCE(p.is_guest, false) = false
   AND NOT (COALESCE(p.self_paid, false) OR COALESCE(a.any_claimed, false))
   AND NOT (p.date_of_birth IS NOT NULL
            AND p.date_of_birth > (current_date - interval '18 years'))
$function$;

REVOKE ALL     ON FUNCTION public._team_debtors(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._team_debtors(text) FROM anon, authenticated;

-- ── 3. admin_waive_debt: settle the rows, recompute owes ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_waive_debt(
  p_admin_token text,
  p_player_id   text,
  p_note        text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id text;
  v_owes    numeric := 0;
  v_player  jsonb;
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

  -- Waive THIS TEAM's outstanding game fees — not `players.owes`, which is a CROSS-TEAM total
  -- (mig 460:33-38). The old code read owes and zeroed it, so waiving on team A silently wiped
  -- the player's team B debt as well.
  SELECT COALESCE(SUM(amount), 0) INTO v_owes
    FROM payment_ledger
   WHERE team_id = v_team_id AND player_id = p_player_id
     AND type = 'game_fee' AND status = 'unpaid';

  -- Deliberately NO "nothing_to_waive" guard: waiving a player who owes £0 has always written
  -- a £0 marker row and changed nothing, and this migration is not the place to start throwing
  -- new errors at a live UI. Behaviour for that case stays byte-identical.
  --
  -- ⚠️ FILED, NOT FIXED HERE: PaymentsScreen shows a waiver AMOUNT field
  -- (waiverAmount, :88/:379) but waiveDebt() only ever sends (adminToken, playerId, note) —
  -- the number the admin types is silently DISCARDED and the whole debt is waived. Partial
  -- waivers look supported and aren't. Pre-existing; needs a product decision (add p_amount,
  -- or drop the field), not a 1am hotfix.

  -- Settle the forgiven rows. THIS is the fix: without it the write-off lives only in the owes
  -- cache, and the next _recompute_player_owes — which admin_confirm_payment calls on every
  -- per-week "Mark paid" — resurrects it.
  UPDATE payment_ledger
     SET status = 'waived', method = 'admin', paid_by = 'admin',
         paid_at = now(), updated_at = now()
   WHERE team_id = v_team_id AND player_id = p_player_id
     AND type = 'game_fee' AND status = 'unpaid';

  -- The marker row: the human-readable "£X written off" line in the ledger UI.
  INSERT INTO payment_ledger
    (id, team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at, note)
  VALUES
    (gen_random_uuid(), v_team_id, p_player_id, null,
     v_owes, 'waiver', 'waived', 'admin', 'admin', now(), p_note);

  -- Recompute rather than zero — keeps any OTHER team's debt intact.
  PERFORM _recompute_player_owes(p_player_id, v_team_id);

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
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
    'disabled', disabled, 'disable_reason', disable_reason, 'team', team
  ) INTO v_player FROM players WHERE id = p_player_id;

  RETURN jsonb_build_object('ok', true, 'player', v_player);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;
