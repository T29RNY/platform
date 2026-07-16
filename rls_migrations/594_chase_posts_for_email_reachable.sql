-- 594: the chase must POST for email-reachable debtors too, and carry the amount (PR #4).
--
-- mig 591's send loop skips anyone without push:
--     CONTINUE WHEN NOT r.has_push;   -- "push is the only transport this RPC drives"
-- True at the time. PR #4 adds the email leg in notify.js, so the RPC must now hand over
-- everyone it can reach by EITHER channel — otherwise an email-reachable debtor is dropped
-- here, before notify.js ever sees them, and the email leg silently reaches nobody.
--
-- Also adds `chaseAmount` to the POST body. notify.js needs the number to build the email
-- subject/body; the alternative is parsing it back out of the push copy ("💷 £15 outstanding
-- for Tuesday…"), which would break the moment anyone edits that string. Pass the datum, not
-- the sentence.
--
-- ⚠️ WHOLE POUNDS, not pence. payment_ledger.amount is pounds (venue_charges.amount_due_pence
-- is the other model). _mailer.js's gbp() helper divides by 100 — using it on this value would
-- tell someone they owe £0.15. The template does its own formatting for exactly this reason.
--
-- attempted_count now counts push-OR-email attempts, which is still honest: it has always
-- meant "handed to the transport", never "delivered" (net.http_post is fire-and-forget; this
-- function returns before anything is sent and cannot know delivery).

CREATE OR REPLACE FUNCTION public.admin_chase_payment(
  p_admin_token text,
  p_dry_run     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id     text;
  v_actor_type  text;
  v_actor_ident text;
  v_day         text;
  v_total       numeric := 0;
  v_targets     jsonb   := '[]'::jsonb;
  v_unreachable jsonb   := '[]'::jsonb;
  v_attempted   int     := 0;
  v_suppressed  int     := 0;
  v_push        int     := 0;
  v_email       int     := 0;
  v_phone       int     := 0;
  v_eligible    int     := 0;
  r             record;
BEGIN
  SELECT r2.team_id, r2.actor_type, r2.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r2;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF v_actor_type NOT IN ('team_admin', 'vice_captain') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_authorised';
  END IF;

  SELECT s.day_of_week INTO v_day FROM schedule s WHERE s.team_id = v_team_id LIMIT 1;

  FOR r IN
    SELECT * FROM _team_debtors(v_team_id) ORDER BY owed DESC
  LOOP
    v_total := v_total + r.owed;

    IF r.last_chased_at IS NOT NULL AND r.last_chased_at >= now() - interval '24 hours' THEN
      v_suppressed := v_suppressed + 1;
      CONTINUE;
    END IF;

    v_eligible := v_eligible + 1;

    IF r.has_push  THEN v_push  := v_push  + 1; END IF;
    IF r.has_email THEN v_email := v_email + 1; END IF;
    IF r.has_phone THEN v_phone := v_phone + 1; END IF;

    v_targets := v_targets || jsonb_build_object(
      'player_id', r.player_id,
      'owed',      r.owed,
      'has_push',  r.has_push,
      'has_email', r.has_email,
      'has_phone', r.has_phone
    );

    IF NOT (r.has_push OR r.has_email OR r.has_phone) THEN
      v_unreachable := v_unreachable || to_jsonb(r.player_id);
    END IF;
  END LOOP;

  IF v_eligible = 0 AND v_suppressed > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'chase_rate_limited';
  END IF;

  IF v_eligible = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_one_owes';
  END IF;

  IF NOT p_dry_run THEN
    FOR r IN
      SELECT * FROM _team_debtors(v_team_id) ORDER BY owed DESC
    LOOP
      CONTINUE WHEN r.last_chased_at IS NOT NULL
                AND r.last_chased_at >= now() - interval '24 hours';
      -- 594: was `CONTINUE WHEN NOT r.has_push`. notify.js now falls back to email for anyone
      -- with no push subscription, so hand over everyone reachable by EITHER channel. Skipping
      -- the email-reachable here would drop them before notify.js could see them.
      CONTINUE WHEN NOT (r.has_push OR r.has_email);

      -- Synchronous rate-limit bookkeeping BEFORE the fire-and-forget post (mig 472:263-274 —
      -- pg_net queues and returns, so notify.js's own log insert is not guaranteed to land
      -- before a rapid second call's cooldown check).
      INSERT INTO notification_log (team_id, player_id, type, game_date, sent_at)
      VALUES (v_team_id, r.player_id, 'adminChasePayment', current_date, now());

      PERFORM net.http_post(
        url     := 'https://app.in-or-out.com/api/notify',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
          'type',        'adminChasePayment',
          'teamId',      v_team_id,
          'playerIds',   jsonb_build_array(r.player_id),
          -- the datum, so notify.js can build an email without parsing the push sentence
          'chaseAmount', r.owed,
          'payload',     jsonb_build_object(
            'title', 'In or Out ⚽',
            'body',  '💷 £' || trim(to_char(r.owed, 'FM999990.00')) ||
                     ' outstanding for ' || COALESCE(v_day, 'the game') ||
                     ' — settle up when you can!',
            'icon',  '/icons/icon-192.png'
          ),
          'gameDate',    to_char(current_date, 'YYYY-MM-DD')
        )
      );

      v_attempted := v_attempted + 1;
    END LOOP;

    INSERT INTO audit_events (
      team_id, actor_type, actor_user_id, actor_identifier,
      action, entity_type, entity_id, metadata
    )
    VALUES (
      v_team_id, v_actor_type, auth.uid(), v_actor_ident,
      'admin_chase_payment_sent', 'team', v_team_id,
      jsonb_build_object(
        'player_ids',        (SELECT jsonb_agg(t -> 'player_id') FROM jsonb_array_elements(v_targets) t),
        'attempted_count',   v_attempted,
        'suppressed_count',  v_suppressed,
        'unreachable_count', jsonb_array_length(v_unreachable),
        'total_outstanding', v_total,
        'notify_type',       'adminChasePayment'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'dry_run',         p_dry_run,
    'targets',         v_targets,
    'total_owed',      v_total,
    'reachable_push',  v_push,
    'reachable_email', v_email,
    'reachable_phone', v_phone,
    'unreachable',     v_unreachable,
    'attempted_count', v_attempted,
    'suppressed_count', v_suppressed
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_chase_payment(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_chase_payment(text, boolean) TO anon, authenticated;
