-- 592_team_debtors_respects_waivers_down.sql
--
-- Reverts mig 592 by restoring the mig-591 _team_debtors body — the version that
-- sums unpaid game_fee/guest_fee WITHOUT subtracting waivers.
--
-- ⚠️ This down re-introduces the mig-592 bug (a waiver is invisible to the chase
-- reader, so forgiven debts are resurrected) — that is what "revert 592" means.
-- Only run it as part of a proper reverse-order rollback (596 down → 595 down →
-- 592 down); 595 ("waiver settles its own rows") supersedes 592 on live, so a
-- lone out-of-order rollback of 592 is not meaningful.
--
-- Written 2026-07-24 to close a Hard-Rule-11 gap: mig 592 shipped without its
-- paired _down.sql (the pre-commit migration gate flags it on any merge commit).

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
  agg AS (
    SELECT d.target_id,
           SUM(d.amount)                                  AS owed,
           bool_or(d.claimed_at IS NOT NULL)              AS any_claimed
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
  JOIN players p      ON p.id = a.target_id
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
