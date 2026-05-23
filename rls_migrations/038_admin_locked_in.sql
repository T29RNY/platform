-- ════════════════════════════════════════════════════════════
-- MIGRATION 038: admin_locked_in flag on players
-- ════════════════════════════════════════════════════════════
-- Adds a flag that turns true when an admin sets a player to
-- status='in' via admin_set_player_status. While true, the
-- player cannot self-restore to 'in' via set_player_status —
-- they may still self-decline (out/maybe/reserve). Any admin
-- status change to out/maybe/reserve/none clears the flag.
--
-- Applied live via Supabase MCP apply_migration on 2026-05-23.
-- This file syncs source-of-truth to the live DB.
-- ════════════════════════════════════════════════════════════

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS admin_locked_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN players.admin_locked_in IS
  'True if admin set status to ''in''. Player cannot self-restore to ''in'' while true. Cleared by any admin status change to out/maybe/reserve/none.';


-- ════════════════════════════════════════════════════════════
-- REPLACES admin_set_player_status (originally migration 012):
-- adds squad-cap guard and writes admin_locked_in alongside status.
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
  v_cap        int;
  v_in_count   int;
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

  -- Cap guard: refuse 'in' if team already at squad_size
  IF p_status = 'in' THEN
    SELECT s.squad_size INTO v_cap
      FROM schedule s WHERE s.team_id = v_team_id AND s.active = true LIMIT 1;

    SELECT COUNT(*) INTO v_in_count
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
      WHERE tp.team_id = v_team_id
        AND p.status = 'in' AND NOT p.disabled
        AND p.id <> p_player_id;

    IF v_cap IS NOT NULL AND v_in_count >= v_cap THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'squad_full';
    END IF;
  END IF;

  SELECT status INTO v_old_status FROM players WHERE id = p_player_id;

  UPDATE players
     SET status          = p_status,
         admin_locked_in = (p_status = 'in')
   WHERE id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'player_status_updated', 'player', p_player_id,
    jsonb_build_object('before', v_old_status, 'after', p_status, 'locked_after', (p_status = 'in'))
  );

  SELECT jsonb_build_object(
    'id',               p.id,
    'name',             p.name,
    'nickname',         p.nickname,
    'status',           p.status,
    'type',             p.type,
    'priority',         p.priority,
    'paid',             p.paid,
    'owes',             p.owes,
    'self_paid',        p.self_paid,
    'paid_by',          p.paid_by,
    'pay_count',        p.pay_count,
    'goals',            p.goals,
    'motm',             p.motm,
    'attended',         p.attended,
    'total',            p.total,
    'w',                p.w,
    'l',                p.l,
    'd',                p.d,
    'bib_count',        p.bib_count,
    'late_dropouts',    p.late_dropouts,
    'injured',          p.injured,
    'injured_since',    p.injured_since,
    'is_guest',         p.is_guest,
    'guest_of',         p.guest_of,
    'note',             p.note,
    'disabled',         p.disabled,
    'disable_reason',   p.disable_reason,
    'admin_locked_in',  p.admin_locked_in,
    'team',             p.team
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
-- REPLACES set_player_status (originally migration 011):
-- refuses self-IN if admin_locked_in=true; also adds cap guard
-- (defense-in-depth — client already gates the IN button when full).
-- Race-condition note: the count→update window can in theory let
-- two simultaneous self-IN calls both pass cap. Accepted for
-- amateur-team scale; row-level locking is disproportionate.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_player_status(
  p_token  text,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id text;
  v_team_id   text;
  v_cap       int;
  v_in_count  int;
  v_locked    boolean;
  v_result    jsonb;
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

  UPDATE players
  SET    status = p_status
  WHERE  id     = v_player_id;

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
$$;

REVOKE EXECUTE ON FUNCTION set_player_status(text, text) FROM public;
GRANT  EXECUTE ON FUNCTION set_player_status(text, text) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- REPLACES get_team_state_by_admin_token (originally migration 010):
-- adds admin_locked_in to the squad jsonb so SquadScreen can render
-- the lock indicator and gate the IN pill without an extra fetch.
-- (player-side read intentionally unchanged — minimal scope.)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_team_state_by_admin_token(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id    text;
  v_team       jsonb;
  v_squad      jsonb;
  v_schedule   jsonb;
  v_matches    jsonb;
  v_bib_hist   jsonb;
  v_settings   jsonb;
  v_cover_pool jsonb;
  v_lckey      text;
BEGIN
  IF p_admin_token IS NULL THEN RETURN NULL; END IF;

  SELECT
    t.id,
    jsonb_build_object(
      'id',                  t.id,
      'name',                t.name,
      'join_code',           t.join_code,
      'onboarding_complete', t.onboarding_complete,
      'admin_email',         t.admin_email,
      'live_channel_key',    t.live_channel_key,
      'created_at',          t.created_at
    )
  INTO v_team_id, v_team
  FROM teams t
  WHERE t.admin_token = p_admin_token;

  IF v_team_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',              p.id,
        'name',            p.name,
        'nickname',        p.nickname,
        'status',          p.status,
        'type',            p.type,
        'priority',        p.priority,
        'paid',            p.paid,
        'owes',            p.owes,
        'self_paid',       p.self_paid,
        'paid_by',         p.paid_by,
        'pay_count',       p.pay_count,
        'goals',           p.goals,
        'motm',            p.motm,
        'attended',        p.attended,
        'total',           p.total,
        'w',               p.w,
        'l',               p.l,
        'd',               p.d,
        'bib_count',       p.bib_count,
        'late_dropouts',   p.late_dropouts,
        'injured',         p.injured,
        'injured_since',   p.injured_since,
        'is_guest',        p.is_guest,
        'guest_of',        p.guest_of,
        'note',            p.note,
        'is_vice_captain', tp.is_vice_captain,
        'disabled',        p.disabled,
        'disable_reason',  p.disable_reason,
        'admin_locked_in', p.admin_locked_in,
        'team',            p.team
      )
    ),
    '[]'::jsonb
  )
  INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id;

  SELECT to_jsonb(s.*)
  INTO   v_schedule
  FROM   schedule s
  WHERE  s.team_id = v_team_id
  AND    s.active  = true
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                    m.id,
        'team_id',               m.team_id,
        'match_date',            m.match_date,
        'score_a',               m.score_a,
        'score_b',               m.score_b,
        'score_type',            m.score_type,
        'last_goal_scorer',      m.last_goal_scorer,
        'scorers',               m.scorers,
        'motm',                  m.motm,
        'bib_holder',            m.bib_holder,
        'team_a',                m.team_a,
        'team_b',                m.team_b,
        'teams_draft',           m.teams_draft,
        'winner',                m.winner,
        'cancelled',             m.cancelled,
        'cancel_reason',         m.cancel_reason,
        'voting_open',           m.voting_open,
        'voting_closes_at',      m.voting_closes_at,
        'vote_count',            m.vote_count,
        'total_voters',          m.total_voters,
        'was_admin_decided',     m.was_admin_decided,
        'admin_decision_pending',m.admin_decision_pending,
        'tied_candidates',       m.tied_candidates,
        'payments',              m.payments,
        'created_at',            m.created_at,
        'team_switches',         m.team_switches
      )
      ORDER BY m.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM matches m
  WHERE m.team_id = v_team_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'team_id',    bh.team_id,
        'player_id',  bh.player_id,
        'name',       bh.name,
        'match_date', bh.match_date,
        'returned',   bh.returned
      )
      ORDER BY bh.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_bib_hist
  FROM bib_history bh
  WHERE bh.team_id = v_team_id;

  SELECT jsonb_build_object('group_name', s.group_name)
  INTO   v_settings
  FROM   settings s
  WHERE  s.team_id = v_team_id
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',      cp.id,
        'team_id', cp.team_id,
        'name',    cp.name,
        'played',  cp.played,
        'owes',    cp.owes
      )
    ),
    '[]'::jsonb
  )
  INTO v_cover_pool
  FROM cover_pool cp
  WHERE cp.team_id = v_team_id;

  SELECT t.live_channel_key
  INTO   v_lckey
  FROM   teams t
  WHERE  t.id = v_team_id;

  RETURN jsonb_build_object(
    'team',             v_team,
    'squad',            v_squad,
    'schedule',         v_schedule,
    'matches',          v_matches,
    'bib_history',      v_bib_hist,
    'settings',         v_settings,
    'cover_pool',       v_cover_pool,
    'live_channel_key', v_lckey
  );
END;
$$;
