-- ════════════════════════════════════════════════════════════════════════════
-- 128 — player_join_team: add audit_events INSERT + notify_team_change broadcast
-- ════════════════════════════════════════════════════════════════════════════
-- HARD RULE 9 (audit_events on every fire-and-forget RPC) and HARD RULE 10
-- (server-side writers must broadcast) — `player_join_team` violated both since
-- inception. It INSERTs a new players row + team_players row but leaves no
-- server-side trail, and never calls notify_team_change. Symptoms:
--   - No audit row when a new-user join goes wrong silently. Join flow has
--     historically been the most fragile path (session 42/43 multi-team bugs).
--   - Other open clients (admin, existing players) don't see the new joiner
--     in realtime — only on the next unrelated broadcast (eg. someone toggles
--     status) does the squad re-fetch happen.
--
-- Mirrors the mig 063 pattern for player-self writes:
--   actor_type='player', actor_identifier='player_token:'||md5(v_ptoken)
--   action='player_joined_team_self'
--
-- Reuses the existing 'player_added' broadcast reason (already whitelisted in
-- notify_team_change). Same semantic as admin_add_player firing 'player_added'.
--
-- Body preserved byte-for-byte from the current pg_proc version. Only two new
-- statements inserted between the second SELECT-into-v_player and RETURN.
-- search_path tightened from 'public' to 'public, pg_temp' (matches migs
-- 063/124 — defense-in-depth against search-path injection).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.player_join_team(
  p_team_id text,
  p_name    text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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

  SELECT to_jsonb(p) INTO v_player
  FROM players p
  JOIN team_players tp ON tp.player_id = p.id
  WHERE p.user_id = v_user_id
    AND tp.team_id = p_team_id
  LIMIT 1;

  IF v_player IS NOT NULL THEN
    RETURN v_player;
  END IF;

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

  -- mig 128: audit + broadcast
  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    p_team_id, 'player', v_user_id,
    'player_token:' || md5(v_ptoken),
    'player_joined_team_self', 'player', v_player_id,
    jsonb_build_object('name', p_name)
  );

  PERFORM notify_team_change(p_team_id, 'player_added');

  SELECT to_jsonb(p) INTO v_player FROM players p WHERE p.id = v_player_id;
  RETURN v_player;
END;
$$;
