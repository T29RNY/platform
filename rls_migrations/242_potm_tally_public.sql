-- 242: get_potm_tally_public — running POTM tally for players, gated on
-- "you've voted first". Counts only ([{nominee_id, votes}] + total), NEVER
-- voter identities (does not widen the get_potm_voting_state who-voted-for-whom
-- leak). Guests excluded (decision 2, mig 219). Read-only; anon + authenticated.
--
-- Gate: if the caller's token has no row in potm_votes for this match, returns
-- { voted: false } with no counts. Match-wide aggregation (both teams) to match
-- the eligible-nominee set the modal renders; p_team_id only validates the match
-- belongs to the squad (mirrors get_potm_tally's match_not_found guard).
--
-- Read-only RPC → ephemeral-verify NOT required (Hard Rule #15 scope is writes).

CREATE OR REPLACE FUNCTION public.get_potm_tally_public(p_token text, p_match_id text, p_team_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_tally     jsonb;
  v_total     int;
BEGIN
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND team_id = p_team_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
  END IF;

  -- GATE: no counts until the caller has cast their own vote for this match.
  IF NOT EXISTS (
    SELECT 1 FROM potm_votes WHERE match_id = p_match_id AND voter_id = v_player_id
  ) THEN
    RETURN jsonb_build_object('voted', false);
  END IF;

  -- Counts only — aggregated by nominee. voter_id is NEVER exposed.
  -- Match-wide (both teams); exclude current guests (decision 2).
  SELECT jsonb_agg(
           jsonb_build_object('nominee_id', nominee_id, 'votes', vote_count::int)
           ORDER BY vote_count DESC
         )
  INTO v_tally
  FROM (
    SELECT pv.nominee_id, COUNT(*) AS vote_count
    FROM potm_votes pv
    WHERE pv.match_id = p_match_id
      AND NOT EXISTS (SELECT 1 FROM players p WHERE p.id = pv.nominee_id AND p.is_guest = true)
    GROUP BY pv.nominee_id
  ) sub;

  v_tally := COALESCE(v_tally, '[]'::jsonb);
  v_total := COALESCE(
    (SELECT SUM((elem->>'votes')::int) FROM jsonb_array_elements(v_tally) AS elem), 0
  );

  RETURN jsonb_build_object('voted', true, 'tally', v_tally, 'total_votes', v_total);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_potm_tally_public(text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_potm_tally_public(text,text,text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
