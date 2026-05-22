-- Migration 031: Group Balancer — Stage 1B
-- Applied to remote 2026-05-22 via MCP (post-apply checks V1–V7 passed).
--
-- Adds the data layer for the Group Balancer feature:
--   • team_players.group_number       int (1–5 or NULL) — admin-only
--   • settings.group_labels           jsonb             — admin-only
--   • matches.predicted_winner        text (A/B/draw)   — admin-only
--   • matches.predicted_confidence    numeric(4,2)
--   • matches.balance_score           numeric(4,2)
--
-- Two new RPCs (admin-only, authenticated grant):
--   • admin_set_player_group(admin_token, player_id, group_number)
--   • admin_clear_all_groups(admin_token)
--
-- Three modified RPCs:
--   • admin_upsert_settings   — adds p_group_labels jsonb DEFAULT NULL
--   • admin_save_teams        — adds 3 trailing prediction params (DEFAULT NULL)
--   • get_team_state_by_admin_token — returns the new admin-only fields
--
-- get_team_state_by_player_token IS NOT TOUCHED.
-- All new fields stay admin-side per the Group Balancer principle:
-- group numbers / win rates / predictions are NEVER visible to players.

-- ─── 1. SCHEMA ADDITIONS ────────────────────────────────────────────────────

ALTER TABLE team_players
  ADD COLUMN IF NOT EXISTS group_number int DEFAULT NULL
  CHECK (group_number IS NULL OR group_number BETWEEN 1 AND 5);

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS group_labels jsonb DEFAULT NULL;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS predicted_winner text
    CHECK (predicted_winner IS NULL OR predicted_winner IN ('A','B','draw'))
    DEFAULT NULL;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS predicted_confidence numeric(4,2) DEFAULT NULL;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS balance_score numeric(4,2) DEFAULT NULL;

-- ─── 2. DROP OLD admin_save_teams SIGNATURE ─────────────────────────────────
-- PostgreSQL treats the new arg list as a separate overload; must drop
-- the 5-arg version first or PostgREST throws
-- "could not choose best candidate function".

DROP FUNCTION IF EXISTS admin_save_teams(text, text, text[], text[], boolean);

-- ─── 3. NEW: admin_set_player_group ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_set_player_group(
  p_admin_token  text,
  p_player_id    text,
  p_group_number int
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id   text;
  v_old_group int;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id
    FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT group_number INTO v_old_group
    FROM team_players
    WHERE team_id = v_team_id AND player_id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'player_not_in_team';
  END IF;

  UPDATE team_players
    SET group_number = p_group_number
    WHERE team_id = v_team_id AND player_id = p_player_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'group_assigned', 'player', p_player_id,
    jsonb_build_object(
      'group_from', v_old_group,
      'group_to',   p_group_number
    )
  );

  PERFORM notify_team_change(v_team_id, 'group_assigned');

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE ALL ON FUNCTION admin_set_player_group(text, text, int) FROM public;
REVOKE ALL ON FUNCTION admin_set_player_group(text, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION admin_set_player_group(text, text, int) TO authenticated;

-- ─── 4. NEW: admin_clear_all_groups ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_clear_all_groups(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id text;
  v_count   int;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  SELECT id INTO v_team_id
    FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_admin_token';
  END IF;

  WITH updated AS (
    UPDATE team_players
      SET group_number = NULL
      WHERE team_id = v_team_id
        AND group_number IS NOT NULL
      RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'groups_cleared', 'team', v_team_id,
    jsonb_build_object('cleared_count', v_count)
  );

  PERFORM notify_team_change(v_team_id, 'groups_cleared');

  RETURN jsonb_build_object('ok', true, 'cleared_count', v_count);

EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$$;

REVOKE ALL ON FUNCTION admin_clear_all_groups(text) FROM public;
REVOKE ALL ON FUNCTION admin_clear_all_groups(text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_clear_all_groups(text) TO authenticated;

-- ─── 5. MODIFIED: admin_upsert_settings ─────────────────────────────────────
-- Drop old 2-arg version first (parameter-count change = new overload).

DROP FUNCTION IF EXISTS admin_upsert_settings(text, text);

CREATE OR REPLACE FUNCTION admin_upsert_settings(
  p_admin_token  text,
  p_group_name   text,
  p_group_labels jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id     text;
  v_settings_id text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF p_group_name IS NULL OR trim(p_group_name) = '' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='group_name_required';
  END IF;

  UPDATE settings
     SET group_name   = trim(p_group_name),
         group_labels = COALESCE(p_group_labels, settings.group_labels)
   WHERE team_id = v_team_id;

  IF NOT FOUND THEN
    v_settings_id := 'sett_' || v_team_id;
    INSERT INTO settings (id, team_id, group_name, group_labels)
    VALUES (v_settings_id, v_team_id, trim(p_group_name), p_group_labels)
    ON CONFLICT (team_id) DO UPDATE SET
      group_name   = EXCLUDED.group_name,
      group_labels = COALESCE(EXCLUDED.group_labels, settings.group_labels);
  END IF;

  PERFORM notify_team_change(v_team_id, 'settings_updated');

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    'settings_updated', 'settings', v_team_id,
    jsonb_build_object(
      'group_name',         trim(p_group_name),
      'group_labels_keys',  CASE WHEN p_group_labels IS NULL
                              THEN null
                              ELSE (SELECT array_agg(k)
                                      FROM jsonb_object_keys(p_group_labels) k)
                            END
    )
  );

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE ALL ON FUNCTION admin_upsert_settings(text, text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION admin_upsert_settings(text, text, jsonb)
  TO authenticated, anon;

-- ─── 6. MODIFIED: admin_save_teams ──────────────────────────────────────────
-- Predictions written only when p_confirm = true.

CREATE OR REPLACE FUNCTION admin_save_teams(
  p_admin_token          text,
  p_match_id             text,
  p_team_a               text[],
  p_team_b               text[],
  p_confirm              boolean DEFAULT false,
  p_predicted_winner     text    DEFAULT NULL,
  p_predicted_confidence numeric DEFAULT NULL,
  p_balance_score        numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id     text;
  v_schedule_id text;
  v_match_id    text;
  v_reason      text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id INTO v_schedule_id
  FROM schedule
  WHERE team_id = v_team_id AND active = true
  LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;

  IF p_match_id IS NOT NULL AND p_match_id <> '' THEN
    IF NOT EXISTS (
      SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
    END IF;
    v_match_id := p_match_id;
  ELSE
    SELECT active_match_id INTO v_match_id FROM schedule WHERE id = v_schedule_id;
    IF v_match_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_match';
    END IF;
  END IF;

  IF p_confirm THEN
    UPDATE matches SET
      team_a               = to_jsonb(p_team_a),
      team_b               = to_jsonb(p_team_b),
      teams_draft          = null,
      predicted_winner     = p_predicted_winner,
      predicted_confidence = p_predicted_confidence,
      balance_score        = p_balance_score
    WHERE id = v_match_id AND team_id = v_team_id;
    v_reason := 'match_teams_saved';
  ELSE
    UPDATE matches SET
      teams_draft = jsonb_build_object(
        'a', to_jsonb(p_team_a),
        'b', to_jsonb(p_team_b)
      )
    WHERE id = v_match_id AND team_id = v_team_id;
    v_reason := 'match_teams_saved';
  END IF;

  PERFORM notify_team_change(v_team_id, v_reason);

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    v_reason, 'match', v_match_id,
    jsonb_build_object(
      'confirmed',          p_confirm,
      'team_a_count',       array_length(p_team_a, 1),
      'team_b_count',       array_length(p_team_b, 1),
      'predicted_winner',   p_predicted_winner,
      'balance_score',      p_balance_score
    )
  );

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id, 'confirmed', p_confirm);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE ALL ON FUNCTION admin_save_teams(text,text,text[],text[],boolean,text,numeric,numeric)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_save_teams(text,text,text[],text[],boolean,text,numeric,numeric)
  TO authenticated, anon;

-- ─── 7. MODIFIED: get_team_state_by_admin_token ─────────────────────────────
-- Adds:
--   • tp.group_number to squad SELECT (admin-only)
--   • s.group_labels to settings SELECT (admin-only)
--   • predicted_winner/predicted_confidence/balance_score to matches SELECT
--
-- get_team_state_by_player_token IS NOT TOUCHED.

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
        'is_vice_captain',tp.is_vice_captain,
        'group_number',   tp.group_number,
        'disabled',       p.disabled,
        'disable_reason', p.disable_reason,
        'team',           p.team
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
        'team_switches',         m.team_switches,
        'predicted_winner',      m.predicted_winner,
        'predicted_confidence',  m.predicted_confidence,
        'balance_score',         m.balance_score
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
        'team_id',   bh.team_id,
        'player_id', bh.player_id,
        'name',      bh.name,
        'match_date',bh.match_date,
        'returned',  bh.returned
      )
      ORDER BY bh.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_bib_hist
  FROM bib_history bh
  WHERE bh.team_id = v_team_id;

  SELECT jsonb_build_object(
    'group_name',   s.group_name,
    'group_labels', s.group_labels
  )
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

REVOKE EXECUTE ON FUNCTION get_team_state_by_admin_token(text) FROM public;
GRANT  EXECUTE ON FUNCTION get_team_state_by_admin_token(text) TO anon;
GRANT  EXECUTE ON FUNCTION get_team_state_by_admin_token(text) TO authenticated;
