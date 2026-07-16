-- 591: admin debt chase — platform_config + _team_debtors + admin_chase_payment
-- (PR #1 of ADMIN_DEBT_CHASE_HANDOFF.md)
--
-- Lets a casual team admin nudge the players who owe money. This migration is the
-- DB surface only and is DARK: nothing calls admin_chase_payment until PR #2 wires
-- the PaymentsScreen button.
--
-- ── Why _team_debtors exists (the load-bearing decision) ────────────────────
-- THREE definitions of "who owes on this team" already exist and they DISAGREE:
--   1. mig 472:236 (casual.chase_payment, dark) — COALESCE(pl.owes,0) > 0
--   2. notify.js:527 (the live debtReminder cron)  — !p.paid && !p.self_paid
--   3. whatever the next consumer inlines
-- (1) is wrong twice over: players.owes is deliberately CROSS-TEAM (mig 460:33-38,
-- RPCS.md:64 — "the recompute is intentionally NOT filtered by p_team_id"), so team
-- A's admin would chase a two-squad player about team B's money; and it doesn't
-- exclude pending claims, so it duns people who've already paid and are waiting on
-- the admin. (2) is why the live cron tells a three-week debtor he owes one week's
-- price. _team_debtors is THE definition; mig 472 and the cron get pointed at it by
-- PR #5 / PR #6. Scoped to the CASUAL ledger only — venue/club money lives in
-- venue_charges (pence, auth.uid()) and is a different model, not a fourth caller.
--
-- ── Operator decisions encoded here (2026-07-16) ────────────────────────────
--  • U18 → "no, guardians": never chase a child. Buildable form = EXCLUDE known
--    minors. players.date_of_birth (mig 056:52) is the casual age signal — NOT
--    member_profiles.dob, which is the club spine and has NO join to players.
--    ⚠️ HONEST LIMIT: date_of_birth is nullable and is not captured on any casual
--    join path, so is_minor means "KNOWN to be a minor" and nothing more. This is a
--    PARTIAL control that FAILS OPEN, shipped deliberately: NULL-means-minor would
--    exclude the entire squad. Same trade-off mig 584 settled for coach ages (only a
--    KNOWN under-age dob is rejected; NULL allowed). The real fix is capturing dob on
--    the casual join path — filed, not built here. Guardians are unreachable from
--    casual by design and are already P11's job (mig 541) on the club side, where
--    children actually live.
--  • Guests → CHASE THE HOST, never the guest. A guest has name + token only
--    (mig 346:124-140) and is unreachable forever; players.guest_of names the host,
--    who IS reachable and IS responsible. A host's `owed` therefore = their own
--    unpaid game_fee + their guests' unpaid guest_fee. NOTE guest_fee is excluded
--    from players.owes by the mig-460 recompute (RPCS.md:68) — another reason this
--    reads the ledger directly rather than the owes cache.
--  • Injured → CHASE THEM. The debt is real regardless of the hamstring, so there is
--    deliberately NO injured filter here.
--    🔴 PR #3 MUST FIX notify.js:688-694, which filters injured players out of EVERY
--    direct-mode push. Correct for an availability nudge (don't ask an injured man if
--    he's playing); WRONG here. Until PR #3 lands, an injured debtor would be silently
--    dropped at the notify.js end. Harmless today because this RPC is dark. Do not
--    "tidy up" this note — the inconsistency is intentional and operator-decided.
--
-- ── Comms only, never a ledger write ───────────────────────────────────────
-- Inherited verbatim from mig 472:276-277 (Locked Decision #3). This RPC must never
-- touch payment_ledger or players.owes.

-- ── 1. platform_config ─────────────────────────────────────────────────────
-- SQL cannot read Vercel's env, so it cannot answer "is the push transport actually
-- configured?" — APNS_KEY_P8 et al live only in the Node runtime (notify.js:46-49).
-- But the honest-reachability guarantee depends on that answer, so we mirror it.
-- Seeded TRUE: the apnsDiag probe (notify.js:112-151) returned
-- {credsAccepted:true, production:true, bundleId:"uk.inorout.app"} on 2026-07-16 —
-- refuting the stale "DORMANT until the operator supplies signing creds" comments at
-- notify.js:28-34 and native-push.js:15-18. Push works.
-- ⚠️ PR #3 must have notify.js write this back from apnsConfigured() on every send /
-- apnsDiag, so a revoked or expired cred can't leave the mirror asserting a push that
-- no longer lands — that would be the exact dishonesty this epic exists to remove.
CREATE TABLE IF NOT EXISTS public.platform_config (
  id                  boolean     PRIMARY KEY DEFAULT true CHECK (id),  -- singleton
  push_transport_live boolean     NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_config (id, push_transport_live)
VALUES (true, true)
ON CONFLICT (id) DO NOTHING;

-- RLS on + NO policies = implicit DENY for every client role; SECDEF access only.
-- House pattern from 399_modular_feature_flags.sql:54-55.
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

-- Must REVOKE from the NAMED roles, not just PUBLIC: this project's
-- ALTER DEFAULT PRIVILEGES auto-grants anon+authenticated on every new object, and a
-- bare REVOKE FROM public does not remove those named grants (mig 460:51-55).
REVOKE ALL ON TABLE public.platform_config FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_config FROM anon, authenticated;

-- ── 2. _team_debtors — THE definition of "who owes on this team" ───────────
-- Internal helper. Returns one row per CHASEABLE target (never a guest, never a
-- known minor). owed is numeric — verified live 2026-07-16: payment_ledger.amount
-- and players.owes are BOTH numeric, though SCHEMA.md:367 calls amount `int` and
-- SCHEMA.md's players block calls owes `int`. The doc is wrong on both; do not
-- reintroduce an integer cast here.
-- Returns ONLY chaseable targets. The non-chaseable exclusions (guest / disabled /
-- pending-claim / known-minor) are applied HERE, not left to the caller, so no future
-- consumer can forget one and chase a child or dun someone who's already paid. That's
-- also why there are no `claimed` / `is_minor` columns in the return: a flag that is
-- always false because the WHERE already removed those rows is a dead column that
-- misleads the next reader.
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
  -- Every unpaid ledger row on THIS team, attributed to the person we'd chase:
  -- a guest's guest_fee is attributed to their host (players.guest_of), never the
  -- guest. Own game_fee is attributed to the player.
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
    -- has_push = a subscription row EXISTS *and* the transport is actually live.
    -- Row-exists alone is what superadmin_health counts (mig 236:55-78) and it
    -- overstates reach: a row proves the player once tapped Enable, not that a push
    -- can land today.
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
   -- never chase a guest directly; their debt has already been rolled up to the host
   AND COALESCE(p.is_guest, false) = false
   -- Pending claims are NOT chaseable — they've paid, the admin just hasn't confirmed.
   -- Predicate reused from mig 463:40-45 rather than reinvented: EITHER the whole-player
   -- self_paid flag OR a claimed_at on any unpaid game_fee row. mig 463 exists precisely
   -- because an earlier reader checked only self_paid and missed per-week claimants —
   -- this is that same bug, inverted, and it would dun people who've already paid.
   AND NOT (COALESCE(p.self_paid, false) OR COALESCE(a.any_claimed, false))
   -- never chase a KNOWN minor (see the honest-limit note in the header)
   AND NOT (p.date_of_birth IS NOT NULL
            AND p.date_of_birth > (current_date - interval '18 years'))
$function$;

REVOKE ALL     ON FUNCTION public._team_debtors(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._team_debtors(text) FROM anon, authenticated;

-- ── 3. admin_chase_payment ─────────────────────────────────────────────────
-- p_dry_run = true  → resolve the audience + reachability, send NOTHING. This is what
--                     powers PR #2's confirm sheet ("4 will get a push, 3 can't be
--                     reached") — the same code path that does the real send, so the
--                     preview cannot drift from the action.
-- p_dry_run = false → also send.
--
-- Returns attempted_count, NEVER sent_count. net.http_post is fire-and-forget: pg_net
-- queues and returns immediately, so this function RETURNS BEFORE ANY PUSH IS SENT and
-- physically cannot know delivery. A field called sent_count would be the exact lie
-- this epic exists to remove (notify.js:715 already returns {sent: subs.length} —
-- subscriptions AIMED AT, not people reached). Delivery truth lands asynchronously in
-- notification_log; PR #2 reads last_chased_at back from _team_debtors.
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
  -- Auth: the casual admin surface is unauthenticated by design — p_admin_token IS
  -- the credential. resolve_admin_caller (mig 074:17-49) accepts the team's
  -- admin_token OR a vice-captain's player token, and derives team_id SERVER-SIDE.
  -- Never accept a team_id from the client.
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

  -- Per-RECIPIENT 24h cooldown, evaluated per target and FILTERED, not fail-all.
  -- Deliberately different from mig 472:243-249, which keys (team_id, type, game_date)
  -- over 120 minutes: that's an availability-chase cadence borrowed wholesale. Debt
  -- persists across weeks, so game_date just makes the key silently mutate; and a 2h
  -- window bounds nothing that matters (an admin could legitimately fire 12 in a day).
  -- 24h per recipient bounds the quantity that actually matters — what ONE human
  -- receives — and lets next week's legitimate chase through with no special-casing.
  -- External check (2026-07): standard dunning is a spaced, escalating sequence, ~weekly
  -- while freshly overdue. Nothing resembles 2h. We don't copy the 7-touch ladder either
  -- — the admin's tap IS the cadence; this is only the harassment floor beneath it.
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

    -- Honest reachability: someone with no push, no email and no phone CANNOT be
    -- reached by this feature at all. PR #2 surfaces these by name with a
    -- copy-for-WhatsApp escape rather than showing a green tick that reached nobody.
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
      CONTINUE WHEN NOT r.has_push;  -- push is the only transport this RPC drives

      -- Write the rate-limit bookkeeping OURSELVES, synchronously, in this same
      -- transaction, BEFORE net.http_post. pg_net is fire-and-forget: it queues the
      -- HTTP call and returns immediately, so notify.js's own notification_log insert
      -- on the far end is NOT guaranteed to land before a rapid second call's cooldown
      -- check runs. Ephemeral-verify found this the hard way on mig 472 (see 472:263-274)
      -- — without it, two chases in quick succession both sail past the cooldown.
      INSERT INTO notification_log (team_id, player_id, type, game_date, sent_at)
      VALUES (v_team_id, r.player_id, 'adminChasePayment', current_date, now());

      -- ONE POST PER PLAYER, carrying THAT player's real debt. Direct mode broadcasts a
      -- single payload to every playerId, so a bulk post cannot personalise the amount —
      -- which is exactly how the live cron ends up telling a three-week debtor he owes
      -- one week's price (notify.js:533 sends schedule.price_per_player, not the debt).
      -- N posts is the cost of being accurate. Amount is whole pounds (casual ledger),
      -- NOT pence — venue_charges.amount_due_pence is the other model.
      --
      -- Host to app.in-or-out.com, NOT www. mig 361:1-8 repointed every DB-originated
      -- POST off www precisely because these calls do NOT follow a redirect and the apex
      -- 307 drops the body. mig 472:279/:348 still hardcode www — written after 361, it
      -- regressed, carrying a rationalising comment inherited from the pre-migration
      -- migs 230/049. 472 is dark so its dead host has never been exercised. PR #5 fixes it.
      --
      -- type='adminChasePayment' is deliberately NOT 'debtReminder' and MUST NOT be added
      -- to RemindersScreen's TRIGGER_LABELS: notify.js:674 skips any type whose trigger is
      -- explicitly false, so reusing debtReminder would let an admin who muted the weekly
      -- automation silently disable his own manual button — HTTP 200, success toast,
      -- nothing sent. Automation toggles govern robots, not a button a human just pressed.
      PERFORM net.http_post(
        url     := 'https://app.in-or-out.com/api/notify',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
          'type',      'adminChasePayment',
          'teamId',    v_team_id,
          'playerIds', jsonb_build_array(r.player_id),
          'payload',   jsonb_build_object(
            'title', 'In or Out ⚽',
            'body',  '💷 £' || trim(to_char(r.owed, 'FM999990.00')) ||
                     ' outstanding for ' || COALESCE(v_day, 'the game') ||
                     ' — settle up when you can!',
            'icon',  '/icons/icon-192.png'
          ),
          'gameDate',  to_char(current_date, 'YYYY-MM-DD')
        )
      );

      v_attempted := v_attempted + 1;
    END LOOP;

    -- Hard Rule 9: every fire-and-forget RPC leaves a server-side trace.
    -- Records the FACT and the counts, never per-player amounts — the set_player_contact
    -- precedent (mig 189) audits has_phone, never the number. audit_events is long-lived
    -- and admin-readable; per-person debt is financial PII about a named individual, and
    -- it's already derivable from payment_ledger by player_id + timestamp. A single
    -- aggregate is enough. (Real audit_events DDL = mig 003:7-26; SCHEMA.md:430-439 is
    -- STALE and documents columns that do not exist.)
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

-- This RPC MUST stay anon-callable: the /admin route is unauthenticated and
-- p_admin_token IS the auth (mig 470:492 pattern). The mig-460:51-55 "REVOKE from the
-- named roles" rule applies to INTERNAL helpers like _team_debtors above — misapplying
-- it here would break every casual admin.
REVOKE ALL ON FUNCTION public.admin_chase_payment(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_chase_payment(text, boolean) TO anon, authenticated;
