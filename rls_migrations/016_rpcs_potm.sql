-- ============================================================
-- Migration 016: POTM admin RPCs
-- Phase B (design only — DO NOT EXECUTE)
-- ============================================================
-- Depends on:
--   003_audit_events.sql
--   007_rls_team_scoped_tables.sql  — potm_votes RLS (zero client access)
--   011_rpcs_token_writes.sql       — notify_team_change; cast_potm_vote +
--                                     get_my_potm_vote already in 011
-- Column names: voter_id, nominee_id (live schema per OI-21)
--
-- Functions:
--   1. admin_open_potm_voting   VOLATILE
--   2. admin_close_potm_voting  VOLATILE
--   3. get_potm_tally           STABLE   — aggregated counts only; no voter_id rows
--
-- Open: 'potm_voting_opened' and 'potm_result_announced' are not in §11.2 locked
-- list — flagged OI-62/OI-63; add before Phase C execution.
--
-- Note: admin_open_potm_voting validates via admin_token. The cron
-- potmVotingOpenJob currently uses service_role and would need to be updated
-- to pass admin_token, or a service-role bypass path added in Phase 2 (OI-64).
-- ============================================================


-- ── 1. admin_open_potm_voting ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_open_potm_voting(
  p_admin_token  text,
  p_match_id     text,
  p_closes_at    timestamptz,
  p_total_voters int
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
  END IF;

  IF EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND voting_open = true) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='voting_already_open';
  END IF;

  UPDATE matches SET
    voting_open      = true,
    voting_closes_at = p_closes_at,
    total_voters     = p_total_voters
  WHERE id = p_match_id AND team_id = v_team_id;

  -- Denormalise to schedule for client realtime subscription
  UPDATE schedule SET
    voting_open      = true,
    voting_closes_at = p_closes_at
  WHERE team_id = v_team_id AND active = true;

  -- OI-62: 'potm_voting_opened' not yet in §11.2 — add before Phase C
  PERFORM notify_team_change(v_team_id, 'potm_voting_opened');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'potm_voting_opened', 'match', p_match_id,
          jsonb_build_object('closes_at', p_closes_at, 'total_voters', p_total_voters));

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_open_potm_voting(text,text,timestamptz,int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_open_potm_voting(text,text,timestamptz,int) TO authenticated, anon;


-- ── 2. admin_close_potm_voting ──────────────────────────────────────────────────
-- Closes voting and records the winner. p_was_admin_decided=true when admin
-- broke a tie. Increments players.motm — Phase 1 known limitation: if
-- admin_save_match_result already set motm for this match, this double-counts.

CREATE OR REPLACE FUNCTION admin_close_potm_voting(
  p_admin_token       text,
  p_match_id          text,
  p_winner_id         text,
  p_was_admin_decided boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
  END IF;

  -- Close voting and record winner on match
  UPDATE matches SET
    voting_open          = false,
    motm                 = p_winner_id,
    was_admin_decided    = p_was_admin_decided,
    admin_decision_pending = false,
    tied_candidates      = null
  WHERE id = p_match_id AND team_id = v_team_id;

  -- Mark winner on player_match
  UPDATE player_match SET was_motm = true
  WHERE match_id = p_match_id AND player_id = p_winner_id AND team_id = v_team_id;

  -- Increment aggregate MOTM counter on players
  UPDATE players SET motm = motm + 1 WHERE id = p_winner_id;

  -- Sync schedule
  UPDATE schedule SET
    voting_open      = false,
    voting_closes_at = null
  WHERE team_id = v_team_id AND active = true;

  -- OI-63: 'potm_result_announced' not yet in §11.2 — add before Phase C
  PERFORM notify_team_change(v_team_id, 'potm_result_announced');

  INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_team_id, 'team_admin', auth.uid(), 'admin_token:' || md5(p_admin_token),
          'potm_voting_closed', 'match', p_match_id,
          jsonb_build_object('winner_id', p_winner_id,
                             'was_admin_decided', p_was_admin_decided));

  RETURN jsonb_build_object('ok', true, 'winner_id', p_winner_id);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_close_potm_voting(text,text,text,boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_close_potm_voting(text,text,text,boolean) TO authenticated, anon;


-- ── 3. get_potm_tally ───────────────────────────────────────────────────────────
-- Returns aggregated vote counts only. Individual voter_id rows are NEVER
-- returned — anonymity of votes is preserved.
-- STABLE: read-only query; no DB modifications.

CREATE OR REPLACE FUNCTION get_potm_tally(
  p_admin_token text,
  p_match_id    text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id   text;
  v_tally     jsonb;
  v_total     int;
  v_max_count int;
  v_is_tie    boolean;
  v_tied      text[];
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
  END IF;

  -- Aggregate by nominee_id — voter_id is never exposed (OI-21, anonymity)
  SELECT jsonb_agg(
           jsonb_build_object('nominee_id', nominee_id, 'vote_count', vote_count::int)
           ORDER BY vote_count DESC
         )
  INTO v_tally
  FROM (
    SELECT nominee_id, COUNT(*) AS vote_count
    FROM potm_votes WHERE match_id = p_match_id
    GROUP BY nominee_id
  ) sub;

  v_tally := COALESCE(v_tally, '[]'::jsonb);

  v_total := COALESCE(
    (SELECT SUM((elem->>'vote_count')::int) FROM jsonb_array_elements(v_tally) AS elem),
    0
  );

  v_max_count := COALESCE(
    (SELECT MAX((elem->>'vote_count')::int) FROM jsonb_array_elements(v_tally) AS elem),
    0
  );

  IF v_max_count > 0 THEN
    SELECT array_agg(elem->>'nominee_id')
    INTO v_tied
    FROM jsonb_array_elements(v_tally) AS elem
    WHERE (elem->>'vote_count')::int = v_max_count;

    v_is_tie := array_length(v_tied, 1) > 1;
  ELSE
    v_tied   := ARRAY[]::text[];
    v_is_tie := false;
  END IF;

  RETURN jsonb_build_object(
    'match_id',        p_match_id,
    'tally',           v_tally,
    'total_votes',     v_total,
    'is_tie',          v_is_tie,
    'tied_candidates', to_jsonb(v_tied)
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION get_potm_tally(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_potm_tally(text,text) TO authenticated, anon;


-- ── Verification queries (commented out) ────────────────────────────────────────
-- SELECT proname, provolatile FROM pg_proc
-- WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
--   AND proname IN ('admin_open_potm_voting','admin_close_potm_voting','get_potm_tally');
-- Expected: 3 rows.
-- admin_open_potm_voting → provolatile='v'
-- admin_close_potm_voting → provolatile='v'
-- get_potm_tally → provolatile='s'
--
-- SELECT get_potm_tally('<admin_token>', '<match_with_votes>');
-- → { match_id, tally:[{nominee_id,vote_count},...], total_votes, is_tie, tied_candidates }
-- Verify: no voter_id key appears anywhere in the response.