-- ════════════════════════════════════════════════════════════════════════════
-- 063 — Audit log expansion for remaining player self-write RPCs
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 060 covered set_player_status and set_player_paid. This migration
-- extends the same pattern to the remaining player-self writes that were
-- leaving no server-side trace:
--
--   set_player_injured           → 'player_injured_self_set'
--   add_guest_player             → 'guest_player_added_self'
--   remove_guest_player          → 'guest_player_removed_self'
--   register_push_subscription   → 'push_subscription_registered'
--   unregister_push_subscription → 'push_subscription_removed'
--   submit_potm_vote             → 'potm_vote_cast_self'
--   link_player_to_user          → 'player_account_linked'
--
-- NOT included:
--   player_create_cash_payment_entry — pure passthrough to set_player_paid
--     (already audited via 060). Adding audit here would double-log.
--
-- Pattern (matches 060):
--   INSERT INTO audit_events (
--     team_id, actor_type, actor_user_id, actor_identifier,
--     action, entity_type, entity_id, metadata
--   ) VALUES (
--     v_team_id, 'player', auth.uid(),
--     'player_token:' || md5(p_token),
--     '<action_label>', 'player', v_player_id,
--     jsonb_build_object(...)
--   );
--
-- Safety: if INSERT fails, the whole RPC fails (same guarantee as 060 and
-- as admin RPCs). Each function preserves its existing body byte-for-byte;
-- only the audit_events INSERT is added.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. set_player_injured ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_player_injured(p_token text, p_injured boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  UPDATE players
  SET    injured       = p_injured,
         injured_since = CASE WHEN p_injured THEN now() ELSE NULL END,
         status        = CASE WHEN p_injured AND status = 'in' THEN 'out'
                              ELSE status
                         END
  WHERE  id = v_player_id;

  IF p_injured THEN
    INSERT INTO player_injuries
      (id, player_id, team_id, injured_at, cleared_at, marked_by)
    VALUES
      (gen_random_uuid(), v_player_id, v_team_id, now(), NULL, 'player');
  ELSE
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

  -- 063: audit
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_injured_self_set', 'player', v_player_id,
    jsonb_build_object('injured', p_injured)
  );

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
$function$;


-- ── 2. add_guest_player ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_guest_player(p_token text, p_guest_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF p_guest_name IS NULL OR length(trim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;
  IF length(trim(p_guest_name)) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  v_guest_id    := generate_url_safe_token('p_', 6);
  v_guest_token := generate_url_safe_token('p_', 12);

  INSERT INTO players (
    id, name, token, type,
    disabled, priority,
    status, paid, owes,
    goals, motm, attended, total,
    bib_count, team, w, l, d,
    pay_count, late_dropouts, note, self_paid,
    is_guest, guest_of
  ) VALUES (
    v_guest_id, trim(p_guest_name), v_guest_token, 'regular',
    false, false,
    'in', false, 0,
    0, 0, 0, 0,
    0, null, 0, 0, 0,
    0, 0, '', false,
    true, v_player_id
  );

  INSERT INTO team_players (team_id, player_id)
  VALUES (v_team_id, v_guest_id);

  -- 063: audit (entity is the new guest, host_id captured in metadata)
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'guest_player_added_self', 'player', v_guest_id,
    jsonb_build_object(
      'host_player_id', v_player_id,
      'guest_name',     trim(p_guest_name)
    )
  );

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
$function$;


-- ── 3. remove_guest_player ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_guest_player(p_token text, p_guest_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
BEGIN
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

  IF NOT EXISTS (
    SELECT 1 FROM players
    WHERE id       = p_guest_id
      AND guest_of = v_player_id
      AND is_guest = true
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_found';
  END IF;

  DELETE FROM team_players
  WHERE player_id = p_guest_id
    AND team_id   = v_team_id;

  DELETE FROM players WHERE id = p_guest_id;

  -- 063: audit (entity is the removed guest; the players row no longer
  -- exists but the audit row preserves the id)
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'guest_player_removed_self', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_player_id)
  );

  PERFORM notify_team_change(v_team_id, 'guest_player_removed');

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;


-- ── 4. register_push_subscription ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_push_subscription(p_token text, p_subscription jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_sub_id    text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

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

  INSERT INTO push_subscriptions (id, player_id, player_token, team_id, subscription)
  VALUES ('sub_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
          v_player_id, p_token, v_team_id, p_subscription)
  ON CONFLICT (player_id)
    DO UPDATE SET subscription  = EXCLUDED.subscription,
                  player_token  = EXCLUDED.player_token
  RETURNING id INTO v_sub_id;

  -- 063: audit. Don't persist subscription endpoint (privacy).
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'push_subscription_registered', 'player', v_player_id,
    jsonb_build_object('subscription_id', v_sub_id)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_sub_id);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;


-- ── 5. unregister_push_subscription ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unregister_push_subscription(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- 063: audit
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'push_subscription_removed', 'player', v_player_id,
    '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;


-- ── 6. submit_potm_vote ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_potm_vote(p_token text, p_match_id text, p_team_id text, p_nominee_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_existing  uuid;
BEGIN
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT id INTO v_existing FROM potm_votes
  WHERE match_id = p_match_id AND voter_id = v_player_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already_voted');
  END IF;

  INSERT INTO potm_votes (match_id, team_id, voter_id, nominee_id)
  VALUES (p_match_id, p_team_id, v_player_id, p_nominee_id);

  -- 063: audit. team_id comes from p_team_id param.
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    p_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'potm_vote_cast_self', 'player', v_player_id,
    jsonb_build_object(
      'match_id',    p_match_id,
      'nominee_id',  p_nominee_id
    )
  );

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;


-- ── 7. link_player_to_user ──────────────────────────────────────────────────
-- Linkage is cross-team. Derive team_id from any team_players row for the
-- audit insert. If the player has no team_players rows, skip audit
-- (shouldn't happen in practice).
CREATE OR REPLACE FUNCTION public.link_player_to_user(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_player_id text;
  v_user_id   uuid;
  v_team_id   text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;

  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM players
    WHERE user_id = v_user_id
      AND id != v_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='user_already_linked';
  END IF;

  UPDATE players SET user_id = v_user_id WHERE id = v_player_id;

  -- 063: audit — derive team_id from any team this player is on
  SELECT team_id INTO v_team_id FROM team_players
    WHERE player_id = v_player_id
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_team_id IS NOT NULL THEN
    INSERT INTO audit_events (
      team_id, actor_type, actor_user_id, actor_identifier,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_team_id, 'player', v_user_id,
      'player_token:' || md5(p_token),
      'player_account_linked', 'player', v_player_id,
      jsonb_build_object('linked_user_id', v_user_id)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'player_id', v_player_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
