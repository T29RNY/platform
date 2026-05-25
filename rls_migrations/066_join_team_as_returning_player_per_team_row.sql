-- ════════════════════════════════════════════════════════════════════════════
-- 066 — join_team_as_returning_player: one player row per team-membership
-- ════════════════════════════════════════════════════════════════════════════
-- Companion to 065. The pre-066 RPC (migration 015) reused the auth user's
-- existing players row for additional team-memberships, sharing one token
-- across multiple teams. Same downstream breakage as the player_join_team
-- bug. See 065 header for the gbains2010 case study.
--
-- Fix: when the auth user already has a players row but is NOT yet in the
-- target team, mint a NEW players row (new id + new token) carrying the
-- existing name/nickname (so the joiner keeps their identity) and the
-- supplied user_id, then insert team_players against the new row. Return
-- the new player_id + token in the existing JSON shape so the client
-- navigates to the right /p/<token>.
--
-- Preserved verbatim from 015:
--   • the "team not found" RAISE
--   • the auth.uid() == p_user_id spoof guard (OI-70)
--   • the "no existing player row" branch returning null player_id so
--     the client shows NameStep
--   • the "already in this team" short-circuit
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION join_team_as_returning_player(
  p_join_code text,
  p_user_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id        text;
  v_existing_id    text;
  v_existing_name  text;
  v_existing_nick  text;
  v_in_team_id     text;
  v_in_team_token  text;
  v_new_id         text;
  v_new_token      text;
BEGIN
  -- Resolve team from join_code (or team_id fallback, matching get_team_by_join_code)
  SELECT id INTO v_team_id FROM teams WHERE join_code = p_join_code OR id = p_join_code LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='team_not_found';
  END IF;

  -- OI-70: prevent authenticated callers from spoofing a different user_id
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='forbidden';
  END IF;

  -- Look for any existing player row for this auth user — used to inherit
  -- name/nickname into the new per-team row.
  SELECT id, name, nickname
    INTO v_existing_id, v_existing_name, v_existing_nick
    FROM players
   WHERE user_id = p_user_id
   ORDER BY created_at ASC
   LIMIT 1;

  -- No existing player record anywhere — signal client to show NameStep.
  IF v_existing_id IS NULL THEN
    RETURN jsonb_build_object(
      'player_id',    null,
      'team_id',      v_team_id,
      'token',        null,
      'is_new_team',  false
    );
  END IF;

  -- Already a member of THIS team via one of my player rows → return that row.
  SELECT p.id, p.token
    INTO v_in_team_id, v_in_team_token
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id
   WHERE p.user_id = p_user_id
     AND tp.team_id = v_team_id
   LIMIT 1;

  IF v_in_team_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'player_id',   v_in_team_id,
      'team_id',     v_team_id,
      'token',       v_in_team_token,
      'is_new_team', false
    );
  END IF;

  -- New team-membership for an existing user: mint a fresh player row + token,
  -- inherit name/nickname so My Squads stays coherent across squads.
  v_new_id    := 'p_' || substr(md5(random()::text), 1, 8);
  v_new_token := generate_url_safe_token('p_', 14);

  INSERT INTO players (
    id, name, nickname, token, user_id, type, status,
    disabled, priority, paid, self_paid,
    goals, motm, attended, total,
    bib_count, w, l, d,
    pay_count, late_dropouts, is_guest
  ) VALUES (
    v_new_id, v_existing_name, v_existing_nick, v_new_token, p_user_id, 'regular', 'none',
    false, false, false, false,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, false
  );

  INSERT INTO team_players (team_id, player_id)
  VALUES (v_team_id, v_new_id)
  ON CONFLICT (team_id, player_id) DO NOTHING;

  RETURN jsonb_build_object(
    'player_id',   v_new_id,
    'team_id',     v_team_id,
    'token',       v_new_token,
    'is_new_team', true
  );

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;

REVOKE EXECUTE ON FUNCTION join_team_as_returning_player(text,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION join_team_as_returning_player(text,uuid) TO authenticated, anon;

SELECT pg_notify('pgrst', 'reload schema');
