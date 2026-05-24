-- ============================================================
-- Migration 046 — superadmin read RPCs (apps/superadmin Phase 2)
--   superadmin_list_teams()                          jsonb[]
--   superadmin_team_detail(p_team_id text)           jsonb
--   superadmin_recent_activity(p_limit, p_since)     jsonb[]
--
-- All gated by is_platform_admin() (migration 045). All SECURITY
-- DEFINER + STABLE + search_path = public. Revoked from anon,
-- granted to authenticated. Each returns jsonb so the JS wrapper
-- has a single shape to consume.
--
-- Schema notes (verified against live DB before commit):
--   teams.{group_name} does NOT exist; teams.{admin_email,join_code} DO.
--   payment_ledger.amount (numeric), not amount_pence. Statuses are
--   'paid' | 'refunded' | 'cancelled'. Per-player debt lives in
--   players.owes; outstanding totals are computed from there, not
--   from the ledger.
-- ============================================================

CREATE OR REPLACE FUNCTION superadmin_list_teams()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'team_id',             t.id,
      'name',                t.name,
      'admin_email',         t.admin_email,
      'join_code',           t.join_code,
      'onboarding_complete', t.onboarding_complete,
      'created_at',          t.created_at,
      'player_count',        (SELECT count(*) FROM team_players WHERE team_id = t.id),
      'admin_count',         (SELECT count(*) FROM team_admins
                              WHERE team_id = t.id AND revoked_at IS NULL),
      'last_match_date',     (SELECT max(match_date) FROM matches WHERE team_id = t.id),
      'outstanding_total',   COALESCE((
        SELECT SUM(p.owes)
        FROM team_players tp
        JOIN players p ON p.id = tp.player_id
        WHERE tp.team_id = t.id AND p.owes > 0
      ), 0),
      'admin_emails',        COALESCE((
        SELECT jsonb_agg(u.email)
        FROM team_admins ta
        JOIN auth.users u ON u.id = ta.user_id
        WHERE ta.team_id = t.id AND ta.revoked_at IS NULL
      ), '[]'::jsonb)
    ) AS row
    FROM teams t
    ORDER BY t.created_at DESC
  ) q;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION superadmin_list_teams() FROM anon;
GRANT EXECUTE ON FUNCTION superadmin_list_teams() TO authenticated;

CREATE OR REPLACE FUNCTION superadmin_team_detail(p_team_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_team     jsonb;
  v_schedule jsonb;
  v_squad    jsonb;
  v_matches  jsonb;
  v_payments jsonb;
  v_admins   jsonb;
  v_events   jsonb;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT to_jsonb(t) INTO v_team FROM teams t WHERE id = p_team_id;
  IF v_team IS NULL THEN
    RAISE EXCEPTION 'team_not_found';
  END IF;

  SELECT to_jsonb(s) INTO v_schedule
  FROM schedule s WHERE s.team_id = p_team_id AND s.active = true LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id',  p.id,
    'name',       p.name,
    'status',     p.status,
    'type',       p.type,
    'team',       p.team,
    'disabled',   p.disabled,
    'is_guest',   p.is_guest,
    'token',      p.token,
    'user_id',    p.user_id,
    'attended',   p.attended,
    'total',      p.total,
    'goals',      p.goals,
    'motm',       p.motm,
    'bib_count',  p.bib_count,
    'priority',   p.priority,
    'paid',       p.paid,
    'owes',       p.owes
  ) ORDER BY p.name), '[]'::jsonb) INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = p_team_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'match_id',    m.id,
    'match_date',  m.match_date,
    'cancelled',   m.cancelled,
    'score_a',     m.score_a,
    'score_b',     m.score_b,
    'winner',      m.winner,
    'team_a',      m.team_a,
    'team_b',      m.team_b,
    'created_at',  m.created_at
  ) ORDER BY m.match_date DESC NULLS LAST), '[]'::jsonb) INTO v_matches
  FROM (
    SELECT * FROM matches WHERE team_id = p_team_id
    ORDER BY match_date DESC NULLS LAST LIMIT 10
  ) m;

  SELECT jsonb_build_object(
    'outstanding_total', COALESCE((
      SELECT SUM(p.owes)
      FROM team_players tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id = p_team_id AND p.owes > 0
    ), 0),
    'unpaid_count', COALESCE((
      SELECT COUNT(*)
      FROM team_players tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id = p_team_id AND p.owes > 0
    ), 0),
    'paid_last_30d', COALESCE((
      SELECT SUM(amount)
      FROM payment_ledger
      WHERE team_id = p_team_id
        AND status = 'paid'
        AND type = 'game_fee'
        AND created_at >= now() - interval '30 days'
    ), 0),
    'ledger_size', COALESCE((SELECT COUNT(*) FROM payment_ledger WHERE team_id = p_team_id), 0)
  ) INTO v_payments;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',     ta.user_id,
    'email',       u.email,
    'role',        ta.role,
    'granted_at',  ta.granted_at,
    'revoked_at',  ta.revoked_at,
    'last_sign_in_at', u.last_sign_in_at
  ) ORDER BY ta.granted_at), '[]'::jsonb) INTO v_admins
  FROM team_admins ta
  JOIN auth.users u ON u.id = ta.user_id
  WHERE ta.team_id = p_team_id AND ta.revoked_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           ae.id,
    'actor_type',   ae.actor_type,
    'actor_email',  u.email,
    'action',       ae.action,
    'entity_type',  ae.entity_type,
    'entity_id',    ae.entity_id,
    'metadata',     ae.metadata,
    'created_at',   ae.created_at
  ) ORDER BY ae.created_at DESC), '[]'::jsonb) INTO v_events
  FROM (
    SELECT * FROM audit_events WHERE team_id = p_team_id
    ORDER BY created_at DESC LIMIT 20
  ) ae
  LEFT JOIN auth.users u ON u.id = ae.actor_user_id;

  RETURN jsonb_build_object(
    'team',         v_team,
    'schedule',     v_schedule,
    'squad',        v_squad,
    'matches',      v_matches,
    'payments',     v_payments,
    'admins',       v_admins,
    'recent_events',v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION superadmin_team_detail(text) FROM anon;
GRANT EXECUTE ON FUNCTION superadmin_team_detail(text) TO authenticated;

CREATE OR REPLACE FUNCTION superadmin_recent_activity(
  p_limit int DEFAULT 100,
  p_since timestamptz DEFAULT now() - interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'created_at') DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id',           ae.id,
      'team_id',      ae.team_id,
      'team_name',    t.name,
      'actor_type',   ae.actor_type,
      'actor_email',  u.email,
      'action',       ae.action,
      'entity_type',  ae.entity_type,
      'entity_id',    ae.entity_id,
      'metadata',     ae.metadata,
      'created_at',   ae.created_at
    ) AS row
    FROM (
      SELECT * FROM audit_events
      WHERE created_at >= p_since
      ORDER BY created_at DESC
      LIMIT p_limit
    ) ae
    LEFT JOIN teams t ON t.id = ae.team_id
    LEFT JOIN auth.users u ON u.id = ae.actor_user_id
  ) q;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION superadmin_recent_activity(int, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION superadmin_recent_activity(int, timestamptz) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
