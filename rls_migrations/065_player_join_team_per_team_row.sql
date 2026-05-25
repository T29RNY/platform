-- ════════════════════════════════════════════════════════════════════════════
-- 065 — player_join_team: one player row per team-membership
-- ════════════════════════════════════════════════════════════════════════════
-- Surfaced by gbains2010 (auth user 31f12159…). He created Finbars Tuesdays
-- on 2026-05-24, then joined Footy Tuesdays via join-link on 2026-05-25.
-- The pre-065 RPC (migration 044) reused his existing players row for both
-- team-memberships. Result: one player.token mapped to two team_players rows,
-- and get_team_state_by_player_token deterministically resolves the EARLIEST
-- team — so gbains was stuck in Finbars with no URL or My Squads click that
-- would land him in Footy Tuesdays.
--
-- Fix: when the auth user already has a players row but is not yet in the
-- target team, mint a NEW players row (new id + new token) with the same
-- user_id and the supplied name, then insert team_players against the new
-- row. Restores the invariant "one player per team-membership, one token
-- per player" assumed by every downstream resolver.
--
-- Pairs with: 066 (same fix on join_team_as_returning_player),
-- 067 (relax link_player_to_user), 068 (delete_my_account loops all
-- player rows), 069 (one-shot split for gbains' shared row).
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS player_join_team(text, text);

CREATE OR REPLACE FUNCTION player_join_team(p_team_id text, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id   uuid;
  v_player_id text;
  v_ptoken    text;
  v_player    jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- 1. Already in this team via any of my player rows? → return that row.
  SELECT to_jsonb(p) INTO v_player
  FROM players p
  JOIN team_players tp ON tp.player_id = p.id
  WHERE p.user_id = v_user_id
    AND tp.team_id = p_team_id
  LIMIT 1;

  IF v_player IS NOT NULL THEN
    RETURN v_player;
  END IF;

  -- 2. Mint a fresh player row + token for this team-membership.
  --    Applies equally whether this is the user's first team (no prior
  --    players row) or an Nth team (already has player rows elsewhere).
  v_player_id := 'p_' || substr(md5(random()::text), 1, 8);
  v_ptoken    := generate_url_safe_token('p_', 14);

  INSERT INTO players (
    id, name, token, user_id, type, status,
    disabled, priority, paid, self_paid,
    goals, motm, attended, total,
    bib_count, w, l, d,
    pay_count, late_dropouts, is_guest
  ) VALUES (
    v_player_id, p_name, v_ptoken, v_user_id, 'regular', 'none',
    false, false, false, false,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, false
  );

  INSERT INTO team_players (team_id, player_id, is_vice_captain)
  VALUES (p_team_id, v_player_id, false);

  SELECT to_jsonb(p) INTO v_player FROM players p WHERE p.id = v_player_id;
  RETURN v_player;
END;
$$;

REVOKE ALL ON FUNCTION player_join_team(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION player_join_team(text, text) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
