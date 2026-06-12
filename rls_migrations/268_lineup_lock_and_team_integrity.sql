-- 268_lineup_lock_and_team_integrity.sql
--
-- SESSION 80 OPEN bug: drawn teams stay mutable after kick-off.
-- A drawn player (Matty, team B) self-toggled injured ON then OFF 23 min AFTER
-- kick-off; the un-injure left him at status='out', so the client rebuilt a
-- 6-man team_b at result-save and his stats diverged. Three stacked failures:
--
--   1. set_player_injured never restored a drawn player to 'in' on un-injure.
--   2. Self-service lineup writes were allowed after kick-off (no lock).
--   3. admin_save_match_result never reconciled a pre-existing player_match row
--      left attended=true / result NULL when the player was dropped from the
--      passed team arrays.
--
-- This migration fixes all three, server-side only (no JS change). All replaced
-- functions keep byte-identical signatures, so CREATE OR REPLACE preserves their
-- existing grants (grants are keyed to the function OID) — no re-grant needed
-- (see the GRANTS note at the foot).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. NEW HELPER — is_lineup_locked
--    True once the team's active, live match has reached its scheduled kick-off.
--    schedule.game_date_time is the TZ-correct Europe/London kick-off (mig 212);
--    casual matches carry no kick-off column, so the schedule is the lock point.
--    game_is_live alone can't gate post-kickoff (it stays true until result-save),
--    hence the now() >= game_date_time clause. Returns false when kick-off is
--    unknown (no active schedule / NULL game_date_time) — safe default, never
--    locks when we can't determine the kick-off instant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_lineup_locked(p_team_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM schedule s
    WHERE s.team_id        = p_team_id
      AND s.active         = true
      AND s.game_is_live   = true
      AND s.game_date_time IS NOT NULL
      AND now() >= s.game_date_time
  );
$function$;

REVOKE ALL ON FUNCTION public.is_lineup_locked(text) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. set_player_injured (player self-toggle)
--    + Fix 2: lineup lock — reject a drawn player's injured-toggle post-kickoff.
--    + Fix 1: un-injure restores a still-drawn player (team IN A/B) to 'in'.
-- ─────────────────────────────────────────────────────────────────────────────
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
  SELECT p.id, tp.team_id INTO v_player_id, v_team_id
    FROM players p JOIN team_players tp ON tp.player_id = p.id
   WHERE p.token = p_token ORDER BY tp.created_at ASC LIMIT 1;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- 268 Fix 2: lineup lock. Once kicked off, a drawn player cannot self-toggle
  -- injured — that would silently mutate the frozen lineup (SESSION 80). Scoped
  -- to drawn players (team IN A/B) so a non-drawn player stays free to act.
  IF is_lineup_locked(v_team_id)
     AND EXISTS (SELECT 1 FROM players WHERE id = v_player_id AND team IN ('A','B')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'lineup_locked';
  END IF;

  UPDATE players
  SET    injured = p_injured,
         injured_since = CASE WHEN p_injured THEN now() ELSE NULL END,
         -- 268 Fix 1: third arm restores a still-drawn player to 'in' on
         -- un-injure (was left at 'out' → dropped from the saved team array).
         status = CASE
                    WHEN p_injured AND status = 'in' THEN 'out'
                    WHEN NOT p_injured AND team IN ('A','B') AND status = 'out' THEN 'in'
                    ELSE status
                  END
  WHERE  id = v_player_id;
  IF p_injured THEN
    UPDATE team_players tp
       SET reserve_priority_order = (
         SELECT COALESCE(MAX(tp2.reserve_priority_order), -1) + 1
         FROM team_players tp2 JOIN players p2 ON p2.id = tp2.player_id
         WHERE tp2.team_id = v_team_id AND p2.status = 'reserve' AND p2.id <> v_player_id)
     WHERE tp.team_id = v_team_id AND tp.player_id = v_player_id
       AND EXISTS (SELECT 1 FROM players px WHERE px.id = v_player_id AND px.status = 'reserve');
  END IF;
  IF p_injured THEN
    INSERT INTO player_injuries (id, player_id, team_id, injured_at, cleared_at, marked_by)
    VALUES (gen_random_uuid(), v_player_id, v_team_id, now(), NULL, 'player');
  ELSE
    UPDATE player_injuries SET cleared_at = now()
    WHERE id = (SELECT id FROM player_injuries
      WHERE player_id = v_player_id AND team_id = v_team_id AND cleared_at IS NULL
      ORDER BY injured_at DESC LIMIT 1);
  END IF;
  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'player', auth.uid(), 'player_token:' || md5(p_token),
    'player_injured_self_set', 'player', v_player_id, jsonb_build_object('injured', p_injured));
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname, 'status', p.status,
    'type', p.type, 'priority', p.priority, 'paid', p.paid, 'owes', p.owes,
    'self_paid', p.self_paid, 'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended, 'total', p.total,
    'w', p.w, 'l', p.l, 'd', p.d, 'bib_count', p.bib_count,
    'late_dropouts', p.late_dropouts, 'injured', p.injured, 'injured_since', p.injured_since,
    'is_guest', p.is_guest, 'guest_of', p.guest_of, 'note', p.note,
    'disabled', p.disabled, 'disable_reason', p.disable_reason, 'team', p.team)
  INTO v_result FROM players p WHERE p.id = v_player_id;
  PERFORM notify_team_change(v_team_id, 'player_injured_updated');
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. admin_set_player_injured (admin path)
--    + Fix 1 only: same restore-on-un-injure arm. NO lineup lock — admins are
--      allowed to edit a frozen lineup mid-game.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_player_injured(p_admin_token text, p_player_id text, p_injured boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id text;
  v_result  jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;
  IF p_injured IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;
  SELECT r.team_id, r.actor_type, r.actor_ident INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;
  UPDATE players
  SET    injured = p_injured,
         injured_since = CASE WHEN p_injured THEN now() ELSE NULL END,
         -- 268 Fix 1: restore a still-drawn player to 'in' on un-injure.
         status = CASE
                    WHEN p_injured AND status = 'in' THEN 'out'
                    WHEN NOT p_injured AND team IN ('A','B') AND status = 'out' THEN 'in'
                    ELSE status
                  END
  WHERE  id = p_player_id;
  IF p_injured THEN
    UPDATE team_players tp
       SET reserve_priority_order = (
         SELECT COALESCE(MAX(tp2.reserve_priority_order), -1) + 1
         FROM team_players tp2 JOIN players p2 ON p2.id = tp2.player_id
         WHERE tp2.team_id = v_team_id AND p2.status = 'reserve' AND p2.id <> p_player_id)
     WHERE tp.team_id = v_team_id AND tp.player_id = p_player_id
       AND EXISTS (SELECT 1 FROM players px WHERE px.id = p_player_id AND px.status = 'reserve');
  END IF;
  IF p_injured THEN
    INSERT INTO player_injuries (id, player_id, team_id, injured_at, cleared_at, marked_by)
    VALUES (gen_random_uuid(), p_player_id, v_team_id, now(), NULL, 'admin');
  ELSE
    UPDATE player_injuries SET cleared_at = now()
    WHERE id = (SELECT id FROM player_injuries
      WHERE player_id = p_player_id AND team_id = v_team_id AND cleared_at IS NULL
      ORDER BY injured_at DESC LIMIT 1);
  END IF;
  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
    'player_injured_updated', 'player', p_player_id, jsonb_build_object('injured', p_injured));
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'nickname', p.nickname, 'status', p.status,
    'type', p.type, 'priority', p.priority, 'paid', p.paid, 'owes', p.owes,
    'self_paid', p.self_paid, 'paid_by', p.paid_by, 'pay_count', p.pay_count,
    'goals', p.goals, 'motm', p.motm, 'attended', p.attended, 'total', p.total,
    'w', p.w, 'l', p.l, 'd', p.d, 'bib_count', p.bib_count,
    'late_dropouts', p.late_dropouts, 'injured', p.injured, 'injured_since', p.injured_since,
    'is_guest', p.is_guest, 'guest_of', p.guest_of, 'note', p.note,
    'disabled', p.disabled, 'disable_reason', p.disable_reason, 'team', p.team)
  INTO v_result FROM players p WHERE p.id = p_player_id;
  PERFORM notify_team_change(v_team_id, 'player_injured_updated');
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. set_player_status (player self-toggle)
--    + Fix 2: post-kickoff lineup lock for a drawn player. Added AFTER the
--      existing game_not_live gate (which does NOT block post-kickoff).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_player_status(p_token text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id    text;
  v_team_id      text;
  v_prev_status  text;
  v_cap          int;
  v_in_count     int;
  v_locked       boolean;
  v_game_live    boolean;
  v_cancelled    boolean;
  v_result       jsonb;
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

  IF p_status IS NULL OR p_status NOT IN ('in','out','maybe','reserve','none') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status';
  END IF;

  SELECT s.game_is_live, COALESCE(s.is_cancelled, false)
    INTO v_game_live, v_cancelled
    FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

  IF v_game_live IS DISTINCT FROM true OR v_cancelled = true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'game_not_live';
  END IF;

  -- 268 Fix 2: post-kickoff lineup lock. A drawn player cannot self-change their
  -- status once the match has kicked off — that mutates the frozen lineup
  -- (SESSION 80). Scoped to drawn players so a non-drawn player can still drop.
  IF is_lineup_locked(v_team_id)
     AND EXISTS (SELECT 1 FROM players WHERE id = v_player_id AND team IN ('A','B')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'lineup_locked';
  END IF;

  IF p_status = 'in' THEN
    SELECT admin_locked_in INTO v_locked FROM players WHERE id = v_player_id;
    IF v_locked = true THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'admin_locked_in';
    END IF;

    SELECT s.squad_size INTO v_cap
      FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

    SELECT COUNT(*) INTO v_in_count
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
      WHERE tp.team_id = v_team_id
        AND p.status = 'in' AND NOT p.disabled
        AND p.id <> v_player_id;

    IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'squad_full';
    END IF;
  END IF;

  SELECT status INTO v_prev_status FROM players WHERE id = v_player_id;

  UPDATE players
  SET    status = p_status
  WHERE  id     = v_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'player_status_set', 'player', v_player_id,
    jsonb_build_object(
      'status',          p_status,
      'previous_status', v_prev_status
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
  WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_status_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. add_guest_player
--    + Fix 2: no new guest once kicked off (a new in-guest alters availability
--      for the frozen lineup). Unscoped — a brand-new guest has no team yet.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- 268 Fix 2: no new guests once the match has kicked off (frozen lineup).
  IF is_lineup_locked(v_team_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'lineup_locked';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. remove_guest_player
--    + Fix 2: a drawn guest cannot be self-removed after kick-off (frozen
--      lineup). Scoped to a drawn guest (team IN A/B).
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- 268 Fix 2: a drawn guest cannot be self-removed after kick-off (frozen
  -- lineup). A non-drawn (dormant / not-yet-drawn) guest can still be removed.
  IF is_lineup_locked(v_team_id)
     AND EXISTS (SELECT 1 FROM players WHERE id = p_guest_id AND team IN ('A','B')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='lineup_locked';
  END IF;

  -- PERSISTENT GUESTS (216): go dormant, do NOT delete.
  UPDATE players SET
    status          = 'none',
    admin_locked_in = false,
    team            = NULL
  WHERE id = p_guest_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'guest_player_removed_self', 'player', p_guest_id,
    jsonb_build_object('host_player_id', v_player_id, 'mode', 'dormant')
  );

  PERFORM notify_team_change(v_team_id, 'guest_player_removed');

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. admin_save_match_result
--    + Fix 3: reconcile any pre-existing player_match row left attended=true /
--      result NULL after the team-array upserts, BEFORE the flat W/L/D bump, so
--      the source-of-truth table can never diverge from the flat columns.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_save_match_result(p_admin_token text, p_match_id text, p_score_type text, p_score_a integer, p_score_b integer, p_winner text, p_margin integer, p_team_a text[], p_team_b text[], p_scorers jsonb, p_motm text, p_last_goal_scorer text, p_bib_holder text, p_team_switches jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id           text;
  v_schedule_id       text;
  v_match_id          text;
  v_match_date        date;
  v_price_per_player  int;
  v_winner            text;
  v_prev_winner       text;
  v_is_fresh_save     boolean;
  v_pid               text;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id, price_per_player INTO v_schedule_id, v_price_per_player
  FROM schedule WHERE team_id = v_team_id AND active = true LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;

  IF p_match_id IS NOT NULL AND p_match_id <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
    END IF;
    v_match_id := p_match_id;
  ELSE
    SELECT active_match_id INTO v_match_id FROM schedule WHERE id = v_schedule_id;
    IF v_match_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_match';
    END IF;
  END IF;

  SELECT match_date, winner INTO v_match_date, v_prev_winner FROM matches WHERE id = v_match_id;

  v_winner := CASE
    WHEN p_winner IN ('D', 'draw', 'd') THEN 'D'
    WHEN upper(p_winner) = 'A'          THEN 'A'
    WHEN upper(p_winner) = 'B'          THEN 'B'
    ELSE NULL
  END;
  IF v_winner IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_winner';
  END IF;

  UPDATE matches SET
    score_a          = p_score_a,
    score_b          = p_score_b,
    score_type       = COALESCE(NULLIF(p_score_type, ''), score_type),
    winner           = v_winner,
    team_a           = to_jsonb(p_team_a),
    team_b           = to_jsonb(p_team_b),
    scorers          = COALESCE(p_scorers, scorers),
    last_goal_scorer = p_last_goal_scorer,
    motm             = NULLIF(p_motm, ''),
    bib_holder       = COALESCE(NULLIF(p_bib_holder, ''), bib_holder),
    team_switches    = p_team_switches
  WHERE id = v_match_id AND team_id = v_team_id;

  IF NOT FOUND THEN
    INSERT INTO matches (id, team_id, match_date, score_a, score_b, score_type,
                         winner, team_a, team_b, scorers, last_goal_scorer,
                         motm, bib_holder, cancelled, voting_open, team_switches)
    VALUES (v_match_id, v_team_id, COALESCE(v_match_date, CURRENT_DATE),
            p_score_a, p_score_b,
            COALESCE(NULLIF(p_score_type, ''), 'exact'),
            v_winner, to_jsonb(p_team_a), to_jsonb(p_team_b),
            p_scorers, p_last_goal_scorer, NULLIF(p_motm, ''),
            NULLIF(p_bib_holder, ''), false, false, p_team_switches);
  END IF;

  v_is_fresh_save := (v_prev_winner IS NULL);

  FOREACH v_pid IN ARRAY p_team_a LOOP
    INSERT INTO player_match (id, team_id, match_id, player_id, attended,
                              team_assignment, result, goals, had_bibs,
                              was_motm, is_guest, late_cancel, injury_absence)
    VALUES (gen_random_uuid(), v_team_id, v_match_id, v_pid, true,
            'A',
            CASE WHEN v_winner = 'A' THEN 'w'
                 WHEN v_winner = 'B' THEN 'l'
                 ELSE 'd' END,
            0,
            (p_bib_holder IS NOT NULL AND p_bib_holder = v_pid),
            (p_motm IS NOT NULL AND p_motm = v_pid),
            false, false, false)
    ON CONFLICT (match_id, player_id) DO UPDATE SET
      attended        = true,
      team_assignment = 'A',
      result          = CASE WHEN v_winner = 'A' THEN 'w'
                             WHEN v_winner = 'B' THEN 'l'
                             ELSE 'd' END,
      was_motm        = (p_motm IS NOT NULL AND p_motm = v_pid),
      had_bibs        = (p_bib_holder IS NOT NULL AND p_bib_holder = v_pid);
  END LOOP;

  FOREACH v_pid IN ARRAY p_team_b LOOP
    INSERT INTO player_match (id, team_id, match_id, player_id, attended,
                              team_assignment, result, goals, had_bibs,
                              was_motm, is_guest, late_cancel, injury_absence)
    VALUES (gen_random_uuid(), v_team_id, v_match_id, v_pid, true,
            'B',
            CASE WHEN v_winner = 'B' THEN 'w'
                 WHEN v_winner = 'A' THEN 'l'
                 ELSE 'd' END,
            0,
            (p_bib_holder IS NOT NULL AND p_bib_holder = v_pid),
            (p_motm IS NOT NULL AND p_motm = v_pid),
            false, false, false)
    ON CONFLICT (match_id, player_id) DO UPDATE SET
      attended        = true,
      team_assignment = 'B',
      result          = CASE WHEN v_winner = 'B' THEN 'w'
                             WHEN v_winner = 'A' THEN 'l'
                             ELSE 'd' END,
      was_motm        = (p_motm IS NOT NULL AND p_motm = v_pid),
      had_bibs        = (p_bib_holder IS NOT NULL AND p_bib_holder = v_pid);
  END LOOP;

  IF p_score_type = 'exact' AND p_scorers IS NOT NULL
     AND jsonb_typeof(p_scorers) = 'object' THEN
    UPDATE player_match pm
      SET goals = (p_scorers ->> pm.player_id)::int
    WHERE pm.match_id  = v_match_id
      AND pm.team_id   = v_team_id
      AND p_scorers ? pm.player_id;
  END IF;

  -- 268 Fix 3 (SESSION 80): reconcile any pre-existing player_match row left
  -- attended=true / result NULL after the array upserts — e.g. a player dropped
  -- from p_team_a/p_team_b by an un-injure that failed to restore (pre-mig-268).
  -- Runs BEFORE the flat W/L/D + owes bump so player_match and the flat columns
  -- can never disagree. A row with a known side derives its result; a sideless
  -- attended row is unscoreable and is demoted out of the count.
  UPDATE player_match pm
  SET result = CASE
                 WHEN pm.team_assignment = v_winner THEN 'w'
                 WHEN v_winner = 'D'                THEN 'd'
                 ELSE 'l'
               END
  WHERE pm.match_id        = v_match_id
    AND pm.team_id         = v_team_id
    AND pm.attended        = true
    AND pm.result IS NULL
    AND pm.team_assignment IN ('A','B');

  UPDATE player_match pm
  SET attended = false
  WHERE pm.match_id        = v_match_id
    AND pm.team_id         = v_team_id
    AND pm.attended        = true
    AND pm.result IS NULL
    AND pm.team_assignment IS NULL;

  IF v_is_fresh_save THEN

    IF v_winner = 'A' THEN
      UPDATE players p SET w = p.w + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'A' AND pm.attended = true;
      UPDATE players p SET l = p.l + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'B' AND pm.attended = true;
    ELSIF v_winner = 'B' THEN
      UPDATE players p SET l = p.l + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'A' AND pm.attended = true;
      UPDATE players p SET w = p.w + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.team_assignment = 'B' AND pm.attended = true;
    ELSE
      UPDATE players p SET d = p.d + 1
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.attended = true;
    END IF;

    IF v_price_per_player IS NOT NULL AND v_price_per_player > 0 THEN
      UPDATE players p SET owes = p.owes + v_price_per_player
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND pm.attended = true
        AND p.paid = false AND p.self_paid = false
        AND p.is_guest = false;

      INSERT INTO payment_ledger
        (id, team_id, player_id, match_id, amount, type, status, method, paid_by, paid_at)
      SELECT gen_random_uuid(), v_team_id, p.id, v_match_id,
             v_price_per_player, 'game_fee', 'unpaid', NULL, NULL, NULL
      FROM players p
      JOIN player_match pm ON pm.player_id = p.id
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.attended = true
        AND p.paid = false AND p.self_paid = false AND p.is_guest = false
        AND NOT EXISTS (
          SELECT 1 FROM payment_ledger l
          WHERE l.player_id = p.id AND l.team_id = v_team_id
            AND l.match_id = v_match_id AND l.type = 'game_fee'
        );
    END IF;

    UPDATE players p SET
      attended        = p.attended + 1,
      total           = p.total    + 1,
      team            = null,
      status          = 'none',
      admin_locked_in = false,
      paid            = (l_paid.id IS NOT NULL),
      self_paid       = false,
      paid_by         = CASE WHEN l_paid.id IS NOT NULL THEN COALESCE(p.paid_by, 'admin') ELSE null END,
      paid_at         = CASE WHEN l_paid.id IS NOT NULL THEN COALESCE(p.paid_at, now()) ELSE null END
    FROM player_match pm
    LEFT JOIN payment_ledger l_paid
      ON l_paid.player_id = pm.player_id AND l_paid.team_id = v_team_id
     AND l_paid.match_id = v_match_id AND l_paid.type = 'game_fee'
     AND l_paid.status = 'paid'
    WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
      AND pm.player_id = p.id AND pm.attended = true;

    UPDATE schedule SET game_is_live = false WHERE id = v_schedule_id;

    UPDATE players p SET status = 'none', team = null
    FROM team_players tp
    WHERE tp.player_id = p.id AND tp.team_id = v_team_id
      AND p.status <> 'none';

    IF p_score_type = 'exact' AND p_scorers IS NOT NULL
       AND jsonb_typeof(p_scorers) = 'object' THEN
      UPDATE players p SET goals = p.goals + (p_scorers ->> p.id)::int
      FROM player_match pm
      WHERE pm.match_id = v_match_id AND pm.team_id = v_team_id
        AND pm.player_id = p.id AND p_scorers ? p.id;
    END IF;

    IF p_motm IS NOT NULL AND p_motm <> '' THEN
      UPDATE players SET motm = motm + 1 WHERE id = p_motm;
    END IF;

    IF NULLIF(p_bib_holder, '') IS NOT NULL THEN
      UPDATE bib_history SET returned = true
        WHERE team_id = v_team_id AND returned = false;
      INSERT INTO bib_history (team_id, player_id, name, match_date, returned)
      VALUES (v_team_id, p_bib_holder,
              (SELECT name FROM players WHERE id = p_bib_holder),
              COALESCE(v_match_date, CURRENT_DATE), false)
      ON CONFLICT (team_id, match_date) DO UPDATE SET
        player_id = EXCLUDED.player_id, name = EXCLUDED.name, returned = false;
      UPDATE players SET bib_count = bib_count + 1 WHERE id = p_bib_holder;
    END IF;

  END IF;

  PERFORM notify_team_change(v_team_id, 'match_result_saved');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'match_result_saved', 'match', v_match_id,
          jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b,
                             'winner', v_winner, 'is_fresh_save', v_is_fresh_save));

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id,
                            'is_fresh_save', v_is_fresh_save);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS — all six replaced functions keep byte-identical signatures, so
-- CREATE OR REPLACE preserved their existing grants by OID. We deliberately do
-- NOT re-state them: re-granting admin_save_match_result would risk widening its
-- (token-gated, authenticated-only) surface to anon. The only object needing an
-- explicit grant statement is the new is_lineup_locked helper (REVOKE above).
-- ─────────────────────────────────────────────────────────────────────────────

SELECT pg_notify('pgrst', 'reload schema');
