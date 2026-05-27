-- 128 down — restore prior player_join_team body (no audit, no broadcast,
-- search_path=public). This is the version captured from pg_proc immediately
-- before mig 128 was applied.

CREATE OR REPLACE FUNCTION public.player_join_team(
  p_team_id text,
  p_name    text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
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

  SELECT to_jsonb(p) INTO v_player FROM players p WHERE p.id = v_player_id;
  RETURN v_player;
END;
$$;
