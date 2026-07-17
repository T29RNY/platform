-- 596: put the chase's email leg behind a flag, OFF. Push + WhatsApp only for now.
--
-- Operator decision 2026-07-17, on seeing the live sheet say "6 will get an email": email is
-- the weakest channel here — nobody reads a subs email. The squad lives in WhatsApp. So the
-- email leg is switched OFF rather than removed: every line of it (mig 594's hand-off,
-- notify.js's fallback, _mailer.js's template) stays exactly where it is, and this flag turns
-- it back on in one UPDATE the day it's wanted.
--
-- ── Why a flag on has_email, and not just hiding it in the UI ────────────────
-- Because "hidden in the UI" is how you get the bug this epic exists to remove. The sheet
-- derives its counts from _team_debtors' has_* flags; the RPC decides who to POST for from the
-- SAME flags. Gate it in ONE place and the sheet, the send, and the "can't be reached" list
-- can never disagree. Hide it in the component only, and the RPC would happily keep emailing
-- people the admin was never told about.
--
-- Symmetric with push_transport_live (mig 591), deliberately:
--     has_push  = a subscription row EXISTS  AND push_transport_live
--     has_email = the player HAS an account  AND chase_email_live
-- Same shape, same table, same reasoning: a capability the player has, ANDed with whether the
-- platform can currently use it. "Can we reach them?" is never "do they have an address?".
--
-- EFFECT on the operator's squad right now: all 6 debtors have an account and no push, so all
-- 6 become correctly unreachable — the sheet shows "6 can't be reached", offers the WhatsApp
-- text, and the Chase button sends nothing because there is genuinely nothing to send. That is
-- the honest state, and it is what makes the WhatsApp copy the real action rather than a
-- consolation prize.
--
-- TO TURN EMAIL BACK ON (one statement, no deploy, no migration):
--     UPDATE platform_config SET chase_email_live = true, updated_at = now() WHERE id;
-- Everything downstream follows immediately: has_email starts returning true, the RPC starts
-- posting for email-reachable debtors, notify.js sends them, and the sheet starts saying so.

ALTER TABLE public.platform_config
  ADD COLUMN IF NOT EXISTS chase_email_live boolean NOT NULL DEFAULT false;

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
  WITH cfg AS (
    SELECT COALESCE((SELECT pc.push_transport_live FROM platform_config pc LIMIT 1), false) AS push_live,
           COALESCE((SELECT pc.chase_email_live    FROM platform_config pc LIMIT 1), false) AS email_live
  ),
  -- Waived rows carry status='waived' since mig 595, so this filter excludes them on its own —
  -- no waiver subtraction (that was 592's workaround, removed by 595; keeping both would
  -- double-count and hide anyone who played AFTER a waiver).
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
    -- capability AND platform-can-use-it. Never just "do they have an address?".
    (EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.player_id = p.id)
       AND (SELECT push_live  FROM cfg))                 AS has_push,
    (p.user_id IS NOT NULL
       AND (SELECT email_live FROM cfg))                 AS has_email,
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
