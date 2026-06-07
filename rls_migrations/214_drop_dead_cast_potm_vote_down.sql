-- DOWN 214: recreate cast_potm_vote verbatim + restore anon/authenticated grants.

CREATE OR REPLACE FUNCTION public.cast_potm_vote(p_token text, p_match_id text, p_nominee_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_team_id   text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_match_id IS NULL OR p_nominee_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input';
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

  IF p_nominee_id = v_player_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ineligible_nominee';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM matches
    WHERE  id           = p_match_id
      AND  team_id      = v_team_id
      AND  voting_open  = true
      AND  voting_closes_at > now()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'voting_closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM player_match
    WHERE  match_id  = p_match_id
      AND  player_id = v_player_id
      AND  attended  = true
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_attended';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM player_match
    WHERE  match_id  = p_match_id
      AND  player_id = p_nominee_id
      AND  attended  = true
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ineligible_nominee';
  END IF;

  INSERT INTO potm_votes (match_id, team_id, voter_id, nominee_id)
  VALUES (p_match_id, v_team_id, v_player_id, p_nominee_id);

  UPDATE matches
  SET    vote_count = COALESCE(vote_count, 0) + 1
  WHERE  id = p_match_id;

  PERFORM notify_team_change(v_team_id, 'potm_vote_cast');

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_voted';
  WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'internal_error';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cast_potm_vote(text, text, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
