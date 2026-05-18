-- ============================================================
-- Migration 010: RPCs — token-based read functions (5 functions)
-- Phase B: design-only; run in Phase C after 001–009 are applied
-- Depends on: 004 (live_channel_key), 004b (team_players.created_at),
--             006–009 (tables locked; these RPCs are the sole read path)
-- ============================================================

-- ── DEPLOYMENT ORDER ─────────────────────────────────────────────────────────
-- These RPCs can be deployed BEFORE migrations 006–009 lock the tables.
-- The functions work whether or not RLS is active. Recommended sequence:
--   1. Apply this migration (010) and 011 (token writes) to production
--   2. Deploy client code that calls these RPCs
--   3. Verify correct data return end-to-end
--   4. Apply 006–009 (RLS lockdown) — direct table queries stop; RPCs continue
-- Running 006–009 before 010 is also valid but will break the client until
-- this migration is applied.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- FUNCTION 1: get_player_by_token
-- Resolves a player token to the player's own data row (§10.1).
-- Used by /p/<token> to bootstrap player identity on load.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_player_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_token IS NULL THEN RETURN NULL; END IF;

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
  FROM players p
  WHERE p.token = p_token;

  RETURN v_result; -- NULL if token not found
END;
$$;

REVOKE EXECUTE ON FUNCTION get_player_by_token(text) FROM public;
GRANT  EXECUTE ON FUNCTION get_player_by_token(text) TO anon;
GRANT  EXECUTE ON FUNCTION get_player_by_token(text) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 2: get_team_by_admin_token
-- Resolves an admin token to the team's metadata.
-- Used by /admin/<admin_token> to establish admin identity.
-- Returns admin_email and live_channel_key (legitimately admin-visible).
-- Never returns admin_token itself.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_team_by_admin_token(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_admin_token IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'id',                  t.id,
    'name',                t.name,
    'join_code',           t.join_code,
    'onboarding_complete', t.onboarding_complete,
    'admin_email',         t.admin_email,
    'live_channel_key',    t.live_channel_key,
    'created_at',          t.created_at
  )
  INTO v_result
  FROM teams t
  WHERE t.admin_token = p_admin_token;

  RETURN v_result; -- NULL if token not found
END;
$$;

REVOKE EXECUTE ON FUNCTION get_team_by_admin_token(text) FROM public;
GRANT  EXECUTE ON FUNCTION get_team_by_admin_token(text) TO anon;
GRANT  EXECUTE ON FUNCTION get_team_by_admin_token(text) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 3: get_team_by_join_code
-- Resolves a join code (or team id) to minimal public team metadata.
-- Used by /join/<code> to display team name before sign-in.
-- Returns no credentials (no admin_token, admin_email, live_channel_key).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_team_by_join_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_code IS NULL THEN RETURN NULL; END IF;

  -- Primary lookup: join_code column
  SELECT jsonb_build_object(
    'id',        t.id,
    'name',      t.name,
    'join_code', t.join_code
  )
  INTO v_result
  FROM teams t
  WHERE t.join_code = p_code;

  -- Fallback: team id (preserves existing getTeamByJoinCode behaviour
  -- which accepted team_id strings as a join code during early rollout)
  IF v_result IS NULL THEN
    SELECT jsonb_build_object(
      'id',        t.id,
      'name',      t.name,
      'join_code', t.join_code
    )
    INTO v_result
    FROM teams t
    WHERE t.id = p_code;
  END IF;

  RETURN v_result; -- NULL if neither lookup matches
END;
$$;

REVOKE EXECUTE ON FUNCTION get_team_by_join_code(text) FROM public;
GRANT  EXECUTE ON FUNCTION get_team_by_join_code(text) TO anon;
GRANT  EXECUTE ON FUNCTION get_team_by_join_code(text) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 4: get_team_state_by_player_token
-- Bulk-loads all data needed to render the player view.
-- Self-row uses §10.1 (full own data). Squad uses §10.2 (no financial/stats).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_team_state_by_player_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id  text;
  v_team_id    text;
  v_player     jsonb;
  v_squad      jsonb;
  v_schedule   jsonb;
  v_matches    jsonb;
  v_bib_hist   jsonb;
  v_settings   jsonb;
  v_cover_pool jsonb;
  v_lckey      text;
BEGIN
  IF p_token IS NULL THEN RETURN NULL; END IF;

  -- 1. Validate token; build §10.1 self-row in one query
  SELECT
    p.id,
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
      'is_vice_captain',p.is_vice_captain,
      'disabled',       p.disabled,
      'disable_reason', p.disable_reason,
      'team',           p.team
    )
  INTO v_player_id, v_player
  FROM players p
  WHERE p.token = p_token;

  IF v_player_id IS NULL THEN RETURN NULL; END IF;

  -- 2. Derive team_id — earliest team_players row (Correction 5, Prompt 2).
  --    (player_id, created_at) index exists from migration 004b.
  SELECT tp.team_id
  INTO   v_team_id
  FROM   team_players tp
  WHERE  tp.player_id = v_player_id
  ORDER BY tp.created_at ASC
  LIMIT 1;

  IF v_team_id IS NULL THEN RETURN NULL; END IF;

  -- 3. Squad — §10.2: identity + status only; no financial, no stats, no auth
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',             p.id,
        'name',           p.name,
        'nickname',       p.nickname,
        'status',         p.status,
        'type',           p.type,
        'priority',       p.priority,
        'is_vice_captain',p.is_vice_captain,
        'disabled',       p.disabled,
        'injured',        p.injured,
        'is_guest',       p.is_guest,
        'guest_of',       p.guest_of,
        'team',           p.team,
        'bib_count',      p.bib_count,
        'note',           p.note
      )
    ),
    '[]'::jsonb
  )
  INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id   = v_team_id
  AND   tp.player_id != v_player_id;

  -- 4. Schedule — full row; active schedule for this team
  SELECT to_jsonb(s.*)
  INTO   v_schedule
  FROM   schedule s
  WHERE  s.team_id = v_team_id
  AND    s.active  = true
  LIMIT 1;

  -- 5. Matches — matches_public column set, newest first
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
        'created_at',            m.created_at
      )
      ORDER BY m.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM matches m
  WHERE m.team_id = v_team_id;

  -- 6. Bib history — newest first
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

  -- 7. Settings — group_name is the only client-visible field for now
  SELECT jsonb_build_object('group_name', s.group_name)
  INTO   v_settings
  FROM   settings s
  WHERE  s.team_id = v_team_id
  LIMIT 1;

  -- 8. Cover pool
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

  -- 9. live_channel_key from teams
  SELECT t.live_channel_key
  INTO   v_lckey
  FROM   teams t
  WHERE  t.id = v_team_id;

  RETURN jsonb_build_object(
    'player',           v_player,
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

REVOKE EXECUTE ON FUNCTION get_team_state_by_player_token(text) FROM public;
GRANT  EXECUTE ON FUNCTION get_team_state_by_player_token(text) TO anon;
GRANT  EXECUTE ON FUNCTION get_team_state_by_player_token(text) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 5: get_team_state_by_admin_token
-- Bulk-loads all data needed to render the admin view.
-- Squad uses §10.3 (all player columns except credentials).
-- Matches includes admin-only columns: teams_draft, payments.
-- team key includes admin_email + live_channel_key; never admin_token.
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

  -- 1. Validate admin token; derive team_id; build team object.
  --    Explicit column list guarantees admin_token is excluded.
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

  -- 2. Squad — §10.3: all player columns except credentials
  --    (token, user_id, paid_at, role_scope, created_at excluded)
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
        'is_vice_captain',p.is_vice_captain,
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

  -- 3. Schedule — full row
  SELECT to_jsonb(s.*)
  INTO   v_schedule
  FROM   schedule s
  WHERE  s.team_id = v_team_id
  AND    s.active  = true
  LIMIT 1;

  -- 4. Matches — full admin column set including teams_draft and payments
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
        'created_at',            m.created_at
      )
      ORDER BY m.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM matches m
  WHERE m.team_id = v_team_id;

  -- 5. Bib history — newest first
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

  -- 6. Settings
  SELECT jsonb_build_object('group_name', s.group_name)
  INTO   v_settings
  FROM   settings s
  WHERE  s.team_id = v_team_id
  LIMIT 1;

  -- 7. Cover pool
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

  -- 8. live_channel_key (also nested inside v_team; exposed at top level for
  --    consistent access pattern with get_team_state_by_player_token — OI-33)
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


-- ────────────────────────────────────────────────────────────────────────
-- Index: supports the token-based read RPCs above.
-- players_by_user_id (migration 006) handles auth.uid() lookups; this
-- index handles the token-based path. Partial WHERE token IS NOT NULL
-- excludes guest rows where token is null (legacy addGuestPlayer sets
-- token: null — see OI-38 for token-on-guest discussion).
-- ────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS players_by_token
  ON players (token)
  WHERE token IS NOT NULL;


-- ════════════════════════════════════════════════════════════
-- POST-APPLY VERIFICATION (run manually in psql / SQL editor)
-- ════════════════════════════════════════════════════════════

-- 1. All five functions exist with SECURITY DEFINER + correct search_path:
-- SELECT proname, prosecdef, proconfig
-- FROM   pg_proc
-- WHERE  pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
-- AND    proname IN (
--   'get_player_by_token',
--   'get_team_by_admin_token',
--   'get_team_by_join_code',
--   'get_team_state_by_player_token',
--   'get_team_state_by_admin_token'
-- );
-- Expected: 5 rows, prosecdef = true for all,
--   proconfig = '{search_path=public,pg_temp}' for all.

-- 2. Index created:
-- SELECT indexname, indexdef
-- FROM   pg_indexes
-- WHERE  schemaname = 'public' AND tablename = 'players'
--   AND  indexname  = 'players_by_token';
-- Expected: 1 row, UNIQUE partial index WHERE token IS NOT NULL.

-- 3. Grants: each function executable by anon + authenticated, not public:
-- SELECT r.routine_name, g.grantee, g.privilege_type
-- FROM   information_schema.routine_privileges g
-- JOIN   information_schema.routines r USING (specific_name)
-- WHERE  r.routine_schema = 'public'
-- AND    r.routine_name IN (
--   'get_player_by_token', 'get_team_by_admin_token', 'get_team_by_join_code',
--   'get_team_state_by_player_token', 'get_team_state_by_admin_token'
-- )
-- ORDER BY r.routine_name, g.grantee;
-- Expected: 10 rows (2 per function: anon + authenticated), no 'public' row.

-- 4. Smoke tests as anon:
-- SET ROLE anon;
-- SELECT get_player_by_token('<known_token>');          -- 29-field jsonb, no 'token' key
-- SELECT get_player_by_token('not_a_real_token');       -- null
-- SELECT get_player_by_token(null);                     -- null, no error
-- SELECT get_team_by_admin_token('<admin_token>');       -- 7-field jsonb, no 'admin_token' key
-- SELECT get_team_by_join_code('<join_code>');           -- 3-field jsonb
-- SELECT get_team_by_join_code('<team_id>');             -- fallback lookup, same shape
-- SELECT get_team_state_by_player_token('<p_token>');   -- keys: player/squad/schedule/matches/bib_history/settings/cover_pool/live_channel_key
-- SELECT get_team_state_by_admin_token('<admin_token>'); -- keys: team/squad/schedule/matches/bib_history/settings/cover_pool/live_channel_key
-- RESET ROLE;

-- 5. Cross-checks:
-- SELECT (get_team_state_by_admin_token('<a_tok>') -> 'squad' -> 0) ? 'token'; -- false
-- SELECT (get_team_state_by_player_token('<p_tok>') -> 'squad' -> 0) ? 'paid';  -- false
-- SELECT (get_team_state_by_player_token('<p_tok>') -> 'squad' -> 0) ? 'name';  -- true
-- SELECT (get_team_state_by_admin_token('<a_tok>'))  ? 'live_channel_key';       -- true (top-level)
-- SELECT (get_team_state_by_admin_token('<a_tok>') -> 'team') ? 'live_channel_key'; -- true (nested)