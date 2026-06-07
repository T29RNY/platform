-- 219: PERSISTENT GUESTS S5 — guests are not eligible for POTM until promoted.
--
-- Decision 2: a guest stays OUT of POTM until promoted (is_guest flipped false).
-- get_potm_voting_state ALREADY excludes guests from the nominee list
-- (pm.is_guest = false), so the voting UI never offers a guest. These three
-- write/tally/close paths lacked the same guard — close them defensively so the
-- rule holds even outside the UI:
--   • submit_potm_vote      — reject a guest nominee (soft error, like already_voted)
--   • get_potm_tally        — drop guest nominees from the aggregated tally
--   • admin_close_potm_voting — refuse to award POTM to a current guest
-- All keyed on the CURRENT players.is_guest flag, so a promoted guest
-- (is_guest=false) becomes eligible automatically. Bodies preserved byte-for-byte
-- except the added guards; existing search_path / grants unchanged.

-- ── submit_potm_vote: reject a guest nominee ────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_potm_vote(p_token text, p_match_id text, p_team_id text, p_nominee_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_existing  uuid;
BEGIN
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  -- S5: a current guest is not POTM-eligible (decision 2).
  IF EXISTS (SELECT 1 FROM players WHERE id = p_nominee_id AND is_guest = true) THEN
    RETURN jsonb_build_object('error', 'nominee_not_eligible');
  END IF;

  SELECT id INTO v_existing FROM potm_votes
  WHERE match_id = p_match_id AND voter_id = v_player_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already_voted');
  END IF;

  INSERT INTO potm_votes (match_id, team_id, voter_id, nominee_id)
  VALUES (p_match_id, p_team_id, v_player_id, p_nominee_id);

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    p_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'potm_vote_cast_self', 'player', v_player_id,
    jsonb_build_object(
      'match_id',    p_match_id,
      'nominee_id',  p_nominee_id
    )
  );

  PERFORM notify_team_change(p_team_id, 'potm_vote_cast');

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

-- ── get_potm_tally: drop guest nominees from the tally ──────────────────────
CREATE OR REPLACE FUNCTION public.get_potm_tally(p_admin_token text, p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Aggregate by nominee_id — voter_id is never exposed (OI-21, anonymity).
  -- S5: exclude votes for current guests (decision 2) so a guest can't win/tie.
  SELECT jsonb_agg(
           jsonb_build_object('nominee_id', nominee_id, 'vote_count', vote_count::int)
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
$function$;

-- ── admin_close_potm_voting: refuse to award a current guest ────────────────
CREATE OR REPLACE FUNCTION public.admin_close_potm_voting(p_admin_token text, p_match_id text, p_winner_id text, p_was_admin_decided boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_type text;
  v_actor_ident text;
  v_team_id text;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
  END IF;

  -- S5: a current guest cannot be awarded POTM (decision 2).
  IF p_winner_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM players WHERE id = p_winner_id AND is_guest = true) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='winner_not_eligible';
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
  VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
          'potm_voting_closed', 'match', p_match_id,
          jsonb_build_object('winner_id', p_winner_id,
                             'was_admin_decided', p_was_admin_decided));

  RETURN jsonb_build_object('ok', true, 'winner_id', p_winner_id);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
