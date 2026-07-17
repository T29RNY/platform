-- 596 DOWN: remove the email flag and ungate has_email.
--
-- ⚠️ You almost certainly want the FLAG, not this. To turn email ON, flip the row — no
-- migration, no deploy, takes effect immediately everywhere:
--
--     UPDATE platform_config SET chase_email_live = true, updated_at = now() WHERE id;
--
-- That is the whole point of 596: the email leg stays built and switchable. Run this down
-- migration ONLY if you want the flag mechanism itself gone (i.e. email permanently ungated,
-- reachable whenever a player has an account).
--
-- Restores _team_debtors to mig 595's version: has_email = (user_id IS NOT NULL), with no
-- platform_config gate. Everything else — the waived-rows filter (595), no waiver subtraction
-- (595 removed 592's workaround), the push_transport_live gate (591), guest roll-up, minor and
-- pending-claim exclusions — is unchanged.
--
-- Drops the column last so the function no longer references it.

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

ALTER TABLE public.platform_config DROP COLUMN IF EXISTS chase_email_live;
