-- 592: _team_debtors must respect a waiver. It didn't, and that is a chase-a-forgiven-debt bug.
--
-- FOUND IN PRODUCTION 2026-07-16 by the operator, on his own squad, ~20 minutes after mig 591
-- shipped. Nothing in the gate suite could have caught it: EV passed 9/9, because the EV
-- fixture had no waived player in it.
--
-- ── The mechanism ──────────────────────────────────────────────────────────
-- admin_waive_debt (live, pre-dating this epic) forgives a debt like this:
--     UPDATE players SET owes = 0 WHERE id = p_player_id;
--     INSERT INTO payment_ledger (amount=<the owes>, type='waiver', status='waived', ...);
-- It does NOT touch the game_fee rows. They stay status='unpaid' forever.
--
-- So a waiver is recorded in exactly two places: players.owes going to 0, and a marker row.
-- The forgiven game_fee rows are indistinguishable from genuinely-unpaid ones.
--
-- mig 591's _team_debtors sums `type='game_fee' AND status='unpaid'` and ignores waivers
-- entirely — so it resurrects every forgiven debt. On the operator's squad that was 8 players
-- and £155 of waived fees (Karan £30, Ranny £25, Gurpal £25, Gurnam £20, Rohan £20, Sav £15,
-- Pritpal £15, Karam £5, all waived at 12:00-12:01 UTC that day). The chase sheet offered to
-- chase 14 people for £235 when 5 people owed £70.
--
-- ── The wrong conclusion this caused, recorded so nobody repeats it ────────
-- This epic's headline finding was "players.owes is a stale cache under-reporting £155 of
-- real debt, the ledger is truth, the screen is wrong." That was BACKWARDS. players.owes was
-- RIGHT — it was the only thing that knew about the waivers. The ledger's unpaid game_fee
-- rows are the stale half. Acting on the wrong conclusion, a backfill ran
-- _recompute_player_owes across all 88 player-team rows and UN-WAIVED 8 debts. Reverted the
-- same session (owes restored to 0; no chase had fired, notification_log = 0 rows, so nobody
-- was ever contacted about a forgiven debt).
--
-- The check that should have caught it and didn't: before the backfill I explicitly tested for
-- the "resurrect an already-settled debt" risk — but only looked for `type='debt_payment'`
-- rows (0 platform-wide) and concluded it was safe. I never queried `type='waiver'`. I asked
-- one specific question instead of the general one: "is there ANY ledger row that means this
-- debt is closed?" There were 8, written that lunchtime.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- owed = SUM(unpaid game_fee) + SUM(unpaid guest_fee via host) - SUM(waived)
-- Correct across the follow-on case too: waive £30, then play 2 more games → unpaid=40,
-- waived=30, owed=10 — the new games are still chaseable, the forgiven ones aren't.
--
-- ⚠️ NOT fixed here (filed): admin_waive_debt should settle the game_fee rows it forgives
-- (status='waived'), so the ledger is self-describing and no future reader can make this
-- mistake. That's a change to a live money RPC + a data migration over existing waivers —
-- operator's call, not a hotfix. Until then, EVERY ledger-based reader must subtract waivers,
-- and _recompute_player_owes is INCOMPATIBLE with a waiver: running it on a waived player
-- silently un-waives them. That trap is live for admin_confirm_payment too — confirming any
-- payment for a waived player recomputes their owes and resurrects the forgiven debt.

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
  -- A waiver is a marker row: admin_waive_debt writes it and zeroes players.owes, but leaves
  -- the forgiven game_fee rows 'unpaid'. So the ONLY way a ledger reader can know a debt was
  -- forgiven is to subtract these. Attributed to the host for a guest's waiver, same as debt.
  waived AS (
    SELECT COALESCE(g.guest_of, l.player_id) AS target_id,
           SUM(l.amount)                     AS amount
      FROM payment_ledger l
      JOIN players g ON g.id = l.player_id
     WHERE l.team_id = p_team_id
       AND l.type    = 'waiver'
       AND l.status  = 'waived'
     GROUP BY COALESCE(g.guest_of, l.player_id)
  ),
  agg AS (
    SELECT d.target_id,
           SUM(d.amount)                     AS gross,
           bool_or(d.claimed_at IS NOT NULL) AS any_claimed
      FROM debt d
     GROUP BY d.target_id
  ),
  net AS (
    SELECT a.target_id,
           a.gross - COALESCE(w.amount, 0) AS owed,
           a.any_claimed
      FROM agg a
      LEFT JOIN waived w ON w.target_id = a.target_id
  )
  SELECT
    p.id AS player_id,
    n.owed,
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
  FROM net n
  JOIN players p       ON p.id = n.target_id
  JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = p_team_id
 WHERE n.owed > 0
   AND COALESCE(p.disabled, false) = false
   AND COALESCE(p.is_guest, false) = false
   AND NOT (COALESCE(p.self_paid, false) OR COALESCE(n.any_claimed, false))
   AND NOT (p.date_of_birth IS NOT NULL
            AND p.date_of_birth > (current_date - interval '18 years'))
$function$;

REVOKE ALL     ON FUNCTION public._team_debtors(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._team_debtors(text) FROM anon, authenticated;
