-- Migration 044 — player_join_team generates token on new-player path
--
-- WHY: The new-player INSERT in 028 omitted `token`, so first-time joiners
-- via the invite link were created with token=NULL. JoinSuccess.jsx reads
-- `player.token` to build the `/p/TOKEN` URL; null token → fallback to `/`,
-- leaving the joiner stranded on the landing page with no way back to their
-- team and no PWA-install breadcrumb (`ioo_last_visited` never set to a
-- useful URL). Surfaced during the pre-Beta audit when the real team was
-- about to send the invite link out.
--
-- Fix: generate a player token with the same helper create_team uses
-- (generate_url_safe_token('p_', 14)) and include it in the new-player INSERT.
-- The existing-player branch is unchanged — those players already have a
-- token from when they were first created.

DROP FUNCTION IF EXISTS player_join_team(text, text);

CREATE OR REPLACE FUNCTION player_join_team(p_team_id text, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

  SELECT id INTO v_player_id
  FROM players
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_player_id IS NOT NULL THEN
    INSERT INTO team_players (team_id, player_id, is_vice_captain)
    VALUES (p_team_id, v_player_id, false)
    ON CONFLICT (team_id, player_id) DO NOTHING;
  ELSE
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
  END IF;

  SELECT to_jsonb(p) INTO v_player
  FROM players p
  WHERE p.id = v_player_id;

  RETURN v_player;
END;
$$;

REVOKE ALL ON FUNCTION player_join_team(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION player_join_team(text, text) TO authenticated;

-- Bust PostgREST schema cache so the new signature is served immediately.
SELECT pg_notify('pgrst', 'reload schema');
