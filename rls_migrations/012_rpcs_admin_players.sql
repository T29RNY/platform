-- ============================================================
-- Migration 012: RPCs — admin player management (9 functions)
-- Phase B: design-only; run in Phase C after 001–009 are applied
--
-- Establishes:
--   - Admin token validation pattern  (admin_token → team_id)
--   - Audit logging pattern           (INSERT into audit_events)
--   - §9 delete guard                 (admin_delete_player)
--
-- Depends on:
--   001_helpers.sql           — generate_url_safe_token (admin_add_player)
--   003_audit_events.sql      — audit_events table; all RPCs INSERT here
--   007_rls_team_scoped.sql   — team_players, player_match, player_injuries
--   008_rls_financial_audit.sql — payment_ledger, potm_votes (§9 guard)
--   011_rpcs_token_writes.sql — notify_team_change helper
-- ============================================================

-- ── SCHEMA NOTE — audit_events columns ───────────────────────────────────────
-- Phase A §5.2 schema (migration 003):
--   id              uuid     DEFAULT gen_random_uuid()
--   team_id         text     NOT NULL
--   actor_user_id   uuid     NULL        (auth.uid(); null for anon token calls)
--   actor_type      text     NOT NULL    CHECK ('team_admin','vice_captain',
--                                         'club_admin','super_admin','player',
--                                         'service_role','system')
--   actor_identifier text    NULL        (token hash when actor_user_id is null)
--   action          text     NOT NULL    (snake_case event name)
--   entity_type     text     NOT NULL    ('player','match','payment_ledger',…)
--   entity_id       text     NOT NULL
--   metadata        jsonb    DEFAULT '{}'
--   created_at      timestamptz DEFAULT now()
--
-- NOTE: Prompt 8 spec used different column names (actor_id, target_type,
-- target_id, payload). This migration uses Phase A §5.2 column names, which
-- are the authoritative schema defined in migration 003.
--
-- Audit INSERT pattern used throughout:
--   INSERT INTO audit_events (
--     team_id, actor_type, actor_user_id, actor_identifier,
--     action, entity_type, entity_id, metadata
--   ) VALUES (
--     v_team_id, 'team_admin', auth.uid(),
--     'admin_token:' || md5(p_admin_token),
--     '<action>', 'player', <entity_id>,
--     jsonb_build_object(…)
--   );
-- ── ADMIN TOKEN VALIDATION PATTERN ───────────────────────────────────────────
-- SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
-- IF v_team_id IS NULL THEN
--   RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
-- END IF;
-- ── PLAYER-IN-TEAM CHECK (all functions that accept p_player_id) ──────────────
-- IF NOT EXISTS (SELECT 1 FROM team_players
--                WHERE team_id = v_team_id AND player_id = p_player_id)
-- THEN
--   RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
-- END IF;
-- ── §10.3 COLUMN SET ─────────────────────────────────────────────────────────
-- All player-return functions use this 29-column set (same as §10.1):
--   id, name, nickname, status, type, priority,
--   paid, owes, self_paid, paid_by, pay_count,
--   goals, motm, attended, total, w, l, d, bib_count, late_dropouts,
--   injured, injured_since, is_guest, guest_of, note,
--   is_vice_captain, disabled, disable_reason, team
-- Excluded: token, user_id, paid_at, role_scope, created_at
-- Exception: admin_add_player ALSO returns token (admin needs it for share links).
-- ── BROADCAST REASON NOTES ───────────────────────────────────────────────────
-- Phase A §11.2 locked reason list. New values added in this migration
-- (not yet in locked list — see OI-44 through OI-47):
--   'player_note_updated'     (Functions 2, 8)  — not yet in locked list
--   'player_vc_toggled'       (Function 5)      — IS in locked list
--   'player_disabled_updated' (Function 6)      — not yet in locked list
--   'player_updated'          (Function 8)      — not yet in locked list
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- FUNCTION 1: admin_set_player_status
-- Admin overrides a player's status from the admin view.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_set_player_status(
  p_admin_token text,
  p_player_id   text,
  p_status      text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id    text;
  v_old_status text;
  v_result     jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('in','out','maybe','reserve','none') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status';
  END IF;

  -- Capture before-state for audit
  SELECT status INTO v_old_status FROM players WHERE id = p_player_id;

  UPDATE players SET status = p_status WHERE id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_status_updated', 'player', p_player_id,
    jsonb_build_object('before', v_old_status, 'after', p_status)
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_status_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_player_status(text, text, text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_set_player_status(text, text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 2: admin_set_player_note
-- Admin sets or clears a player's freetext note.
-- p_note = NULL clears the note. Max 200 chars when non-null.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_set_player_note(
  p_admin_token text,
  p_player_id   text,
  p_note        text    -- NULL to clear
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id text;
  v_result  jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  IF p_note IS NOT NULL AND length(p_note) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  UPDATE players SET note = p_note WHERE id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_note_updated', 'player', p_player_id,
    jsonb_build_object('note', p_note)
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_note_updated'); -- OI-44: not yet in Phase A §11.2

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_player_note(text, text, text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_set_player_note(text, text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 3: admin_set_player_injured
-- Admin marks a player injured or recovered.
-- Mirrors set_player_injured (migration 011) but uses admin token
-- and sets marked_by = 'admin' in player_injuries.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_set_player_injured(
  p_admin_token text,
  p_player_id   text,
  p_injured     boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id text;
  v_result  jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF p_injured IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  -- Update player: set injured flag, injured_since, and auto-out if was 'in'
  UPDATE players
  SET    injured       = p_injured,
         injured_since = CASE WHEN p_injured     THEN now()  ELSE NULL END,
         status        = CASE WHEN p_injured AND status = 'in' THEN 'out'
                              ELSE status
                         END
  WHERE  id = p_player_id;

  -- Injury log: matches insertPlayerInjury / clearPlayerInjury pattern;
  -- marked_by = 'admin' distinguishes from player self-report ('player')
  IF p_injured THEN
    INSERT INTO player_injuries (id, player_id, team_id, injured_at, cleared_at, marked_by)
    VALUES ('inj_' || substr(gen_random_uuid()::text, 1, 12),
            p_player_id, v_team_id, now(), NULL, 'admin');
  ELSE
    UPDATE player_injuries
    SET    cleared_at = now()
    WHERE  id = (
      SELECT id FROM player_injuries
      WHERE  player_id  = p_player_id
        AND  team_id    = v_team_id
        AND  cleared_at IS NULL
      ORDER BY injured_at DESC
      LIMIT 1
    );
  END IF;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_injured_updated', 'player', p_player_id,
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_injured_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_player_injured(text, text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION admin_set_player_injured(text, text, boolean) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 4: admin_set_player_priority
-- Admin sets or clears the priority-invite-window flag.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_set_player_priority(
  p_admin_token text,
  p_player_id   text,
  p_priority    boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id text;
  v_result  jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF p_priority IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  UPDATE players SET priority = p_priority WHERE id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_priority_updated', 'player', p_player_id,
    jsonb_build_object('priority', p_priority)
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_priority_updated');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_player_priority(text, text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION admin_set_player_priority(text, text, boolean) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 5: admin_set_vice_captain
-- Admin toggles the vice captain flag.
-- Guest players cannot be VC: mirrors toggleViceCaptain guest
-- guard in supabase.js.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_set_vice_captain(
  p_admin_token text,
  p_player_id   text,
  p_is_vc       boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id  text;
  v_is_guest boolean;
  v_result   jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF p_is_vc IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  -- Guest guard: guests cannot be made vice captain
  SELECT is_guest INTO v_is_guest FROM players WHERE id = p_player_id;
  IF v_is_guest = true AND p_is_vc = true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden';
  END IF;

  UPDATE players SET is_vice_captain = p_is_vc WHERE id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_vc_updated', 'player', p_player_id,
    jsonb_build_object('is_vice_captain', p_is_vc)
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_vc_toggled'); -- Phase A §11.2 locked

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_vice_captain(text, text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION admin_set_vice_captain(text, text, boolean) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 6: admin_disable_player
-- Admin disables (p_disabled=true) or re-enables (false) a player.
-- On disable: stores p_reason in disable_reason (nullable).
-- On re-enable: clears disable_reason regardless of p_reason.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_disable_player(
  p_admin_token text,
  p_player_id   text,
  p_disabled    boolean,
  p_reason      text       -- nullable; only meaningful when p_disabled=true
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id     text;
  v_audit_action text;
  v_result      jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF p_disabled IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  UPDATE players
  SET    disabled       = p_disabled,
         disable_reason = CASE WHEN p_disabled THEN p_reason ELSE NULL END
  WHERE  id = p_player_id;

  -- Two distinct audit actions so the log is queryable by enable/disable separately
  v_audit_action := CASE WHEN p_disabled THEN 'player_disabled' ELSE 'player_enabled' END;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    v_audit_action, 'player', p_player_id,
    jsonb_build_object('disabled', p_disabled, 'reason', p_reason)
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, v_audit_action); -- OI-45: not yet in Phase A §11.2

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_disable_player(text, text, boolean, text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_disable_player(text, text, boolean, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 7: admin_add_player
-- Admin adds a new player to the team.
-- Unlike all other admin player RPCs, the response INCLUDES token
-- because the admin needs it to generate a share link.
-- Mirrors addPlayerToTeam in supabase.js.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_add_player(
  p_admin_token text,
  p_name        text,
  p_type        text    DEFAULT 'regular',
  p_priority    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id   text;
  v_player_id text;
  v_token     text;
  v_result    jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  -- Name validation
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;
  IF length(trim(p_name)) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  -- Type validation; default to 'regular' if unrecognised
  IF p_type IS NULL OR p_type NOT IN ('regular','cover') THEN
    p_type := 'regular';
  END IF;

  -- Generate IDs using migration 001 helper
  v_player_id := generate_url_safe_token('p_', 6);
  v_token     := generate_url_safe_token('p_', 12);

  -- Full default row — matches addPlayerToTeam column set in supabase.js
  INSERT INTO players (
    id, name, token, type, priority,
    disabled, is_vice_captain, status,
    paid, owes, goals, motm, attended, total,
    bib_count, team, w, l, d,
    pay_count, late_dropouts, note, self_paid
  ) VALUES (
    v_player_id, trim(p_name), v_token, p_type, COALESCE(p_priority, false),
    false, false, 'none',
    false, 0, 0, 0, 0, 0,
    0, null, 0, 0, 0,
    0, 0, '', false
  );

  INSERT INTO team_players (team_id, player_id)
  VALUES (v_team_id, v_player_id);

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_added', 'player', v_player_id,
    jsonb_build_object('name', trim(p_name), 'type', p_type, 'priority', p_priority)
  );

  -- §10.3 + token (admin needs token for share link generation)
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
    'team',           p.team,
    'token',          p.token   -- only admin_add_player returns token
  )
  INTO v_result
  FROM players p WHERE p.id = v_player_id;

  PERFORM notify_team_change(v_team_id, 'player_added');

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_add_player(text, text, text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION admin_add_player(text, text, text, boolean) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 8: admin_update_player_name
-- Admin updates a player's display name or nickname.
-- p_name = NULL → leave name unchanged.
-- p_nickname = NULL → leave nickname unchanged.
-- p_nickname = '' (empty string) → clear nickname to NULL in DB.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_update_player_name(
  p_admin_token text,
  p_player_id   text,
  p_name        text,   -- NULL = no-op on name
  p_nickname    text    -- NULL = no-op; '' = clear
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id text;
  v_result  jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  -- Name validation (only if caller intends to change it)
  IF p_name IS NOT NULL AND length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;
  IF p_name IS NOT NULL AND length(trim(p_name)) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
  END IF;

  UPDATE players
  SET    name     = COALESCE(p_name, name),
         nickname = CASE
                      WHEN p_nickname IS NULL THEN nickname  -- no change
                      WHEN p_nickname = ''    THEN NULL       -- explicit clear
                      ELSE trim(p_nickname)
                    END
  WHERE  id = p_player_id;

  -- Using 'player_note_updated' as the closest Phase A §11.2 audit action.
  -- Phase A §11.2 does not yet have 'player_name_updated'. See OI-46.
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_note_updated', 'player', p_player_id, -- OI-46: should be 'player_name_updated'
    jsonb_build_object('name', p_name, 'nickname', p_nickname)
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
    'is_vice_captain',p.is_vice_captain,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p WHERE p.id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_updated'); -- OI-47: not yet in Phase A §11.2

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_update_player_name(text, text, text, text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_update_player_name(text, text, text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 9: admin_delete_player
-- Hard-deletes a player after passing the §9 history guard.
-- If guard fails, raises 'has_history'; UI directs admin to
-- admin_disable_player instead.
--
-- §9 guard blocks deletion if the player has ANY of:
--   players.attended > 0          (attended a match)
--   player_match rows             (match participation record)
--   payment_ledger rows           (any financial record, any status)
--   potm_votes rows               (voted or was nominated)
--   player_injuries rows          (injury history)
--
-- NOTE: Prompt 8 spec guards on payment_ledger status='paid' only.
-- Phase A §9 blocks on ANY payment_ledger rows (any status). Phase A
-- is used here — see OI-48 for reconciliation.
--
-- Delete cascade order (referencing tables before referenced):
--   1. team_players   (FK → players.id, scoped to this team)
--   2. player_injuries (FK → players.id, scoped to this team)
--   3. push_subscriptions (FK → players.id, global)
--   4. players        (base row)
--
-- Phase 2 multi-team guard (NOT IMPLEMENTED in Phase B):
--   After step 1, if team_players still has rows for this player_id
--   (player belongs to other teams), skip steps 3–4 and leave the
--   players row intact. At Stage 1 every player belongs to one team;
--   this guard prevents data loss when multi-team is introduced.
--
-- player_career rows cleaned up in cascade (OI-49 resolved).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_delete_player(
  p_admin_token text,
  p_player_id   text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id text;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_players WHERE team_id = v_team_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;

  -- §9 guard: block if player has any cross-table history
  IF (
    -- Has attended at least one match (aggregate column)
    COALESCE((SELECT attended FROM players WHERE id = p_player_id), 0) > 0
    -- Has player_match rows (granular attendance record)
    OR EXISTS (SELECT 1 FROM player_match WHERE player_id = p_player_id)
    -- Has any payment_ledger rows (financial history, any status)
    OR EXISTS (SELECT 1 FROM payment_ledger WHERE player_id = p_player_id)
    -- Has voted or been nominated for POTM (voter_id/nominee_id per OI-21)
    OR EXISTS (
      SELECT 1 FROM potm_votes
      WHERE voter_id = p_player_id OR nominee_id = p_player_id
    )
    -- Has injury records
    OR EXISTS (SELECT 1 FROM player_injuries WHERE player_id = p_player_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'has_history';
  END IF;

  -- Audit before deletion (entity still exists at time of audit)
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_deleted', 'player', p_player_id,
    jsonb_build_object('player_id', p_player_id)
  );

  -- Delete in cascade order: referencing rows first, players row last
  DELETE FROM team_players
  WHERE  player_id = p_player_id
    AND  team_id   = v_team_id;

  DELETE FROM player_injuries
  WHERE  player_id = p_player_id
    AND  team_id   = v_team_id;

  DELETE FROM push_subscriptions
  WHERE  player_id = p_player_id;

  DELETE FROM player_career WHERE player_id = p_player_id;

  -- Phase 2 multi-team guard (not implemented):
  -- At this point, if COUNT(*) FROM team_players WHERE player_id = p_player_id > 0,
  -- skip the players DELETE and return { ok: true, note: 'membership_removed_only' }.
  -- For Stage 1, all players are single-team; proceed unconditionally.

  DELETE FROM players WHERE id = p_player_id;

  PERFORM notify_team_change(v_team_id, 'player_deleted');

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_delete_player(text, text) FROM public;
GRANT  EXECUTE ON FUNCTION admin_delete_player(text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- POST-APPLY VERIFICATION (run manually)
-- ════════════════════════════════════════════════════════════

-- 1. All nine functions exist with SECURITY DEFINER + VOLATILE:
-- SELECT proname, prosecdef, provolatile
-- FROM   pg_proc
-- WHERE  pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
--   AND  proname IN (
--     'admin_set_player_status', 'admin_set_player_note',
--     'admin_set_player_injured', 'admin_set_player_priority',
--     'admin_set_vice_captain', 'admin_disable_player',
--     'admin_add_player', 'admin_update_player_name', 'admin_delete_player'
--   );
-- Expected: 9 rows, prosecdef = true, provolatile = 'v' for all.

-- 2. Grants: all nine callable by anon + authenticated:
-- SELECT routine_name, grantee
-- FROM   information_schema.routine_privileges
-- WHERE  routine_schema = 'public'
--   AND  grantee IN ('anon','authenticated')
--   AND  routine_name IN (
--     'admin_set_player_status', 'admin_set_player_note',
--     'admin_set_player_injured', 'admin_set_player_priority',
--     'admin_set_vice_captain', 'admin_disable_player',
--     'admin_add_player', 'admin_update_player_name', 'admin_delete_player'
--   )
-- ORDER BY routine_name, grantee;
-- Expected: 18 rows (9 functions × 2 grantees).

-- 3. Smoke tests as anon:
-- SELECT admin_set_player_status('<admin_token>', '<player_id>', 'out');
-- → §10.3 player row, no 'token' key
-- SELECT admin_set_player_status('<admin_token>', '<player_id>', 'invalid');
-- → P0001: invalid_status
-- SELECT admin_set_player_status('bad_token', '<player_id>', 'out');
-- → P0001: invalid_admin_token
-- SELECT admin_set_player_status(null, '<player_id>', 'out');
-- → P0001: invalid_admin_token
-- SELECT admin_set_vice_captain('<admin_token>', '<guest_player_id>', true);
-- → P0001: forbidden
-- SELECT admin_add_player('<admin_token>', 'Test Player', 'regular', false);
-- → §10.3 row WITH 'token' key present
-- SELECT admin_add_player('<admin_token>', 'Test Player', 'regular', false) ? 'token';
-- → true
-- SELECT admin_set_player_status('<admin_token>', '<admin_add_player_result>.id', 'in')
--   ? 'token';
-- → false (admin_set_player_status must NOT return token)

-- 4. §9 guard smoke test:
-- SELECT admin_delete_player('<admin_token>', '<player_with_attended_gt_0>');
-- → P0001: has_history
-- SELECT admin_delete_player('<admin_token>', '<fresh_player_zero_history>');
-- → { "ok": true }
-- SELECT * FROM players WHERE id = '<fresh_player_zero_history>'; -- should return nothing

-- 5. Audit trail verification (run after any admin action above):
-- SELECT action, entity_type, entity_id, actor_identifier, created_at
-- FROM   audit_events
-- WHERE  team_id = '<team_id>'
-- ORDER  BY created_at DESC
-- LIMIT  10;
-- Expected: one row per admin action, actor_identifier = 'admin_token:' || md5(token).

-- 6. Confirm admin_update_player_name null-handling:
-- SELECT admin_update_player_name('<admin_token>', '<player_id>', null, '');
-- → name unchanged, nickname set to NULL
-- SELECT admin_update_player_name('<admin_token>', '<player_id>', 'New Name', null);
-- → name = 'New Name', nickname unchanged