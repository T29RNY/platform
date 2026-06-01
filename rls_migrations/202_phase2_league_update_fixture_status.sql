-- 202_phase2_league_update_fixture_status.sql
--
-- League dashboard write: postpone / void / walkover / forfeit a fixture by
-- league_admin_token (mirrors venue_update_fixture_status mig 096). Ownership
-- via competition -> season.league_id. Audits + broadcasts to league, venue
-- and both teams.
-- Ephemeral-verify (with mig 203): 5 transitions + 7 error paths, leak clean.
--
--   league_update_fixture_status(p_league_token, p_fixture_id, p_new_status, p_metadata)
--     postpone: { postpone_reason }   void: { void_reason }
--     walkover: { winner_team_id }     forfeit: { winner_team_id, forfeit_reason }

CREATE OR REPLACE FUNCTION public.league_update_fixture_status(
  p_league_token text,
  p_fixture_id   uuid,
  p_new_status   text,
  p_metadata     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_league_id text;
  v_venue_id text;
  v_fixture record;
  v_winner text;
  v_reason text;
  v_broadcast_reason text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_league_caller(p_league_token);
  IF v_caller IS NULL OR v_caller.league_id IS NULL THEN
    RAISE EXCEPTION 'invalid_league_token' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_caller.league_id;
  v_venue_id  := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_status NOT IN ('postponed','void','walkover','forfeit') THEN
    RAISE EXCEPTION 'status_not_supported_by_this_rpc' USING ERRCODE = 'P0001', DETAIL = p_new_status;
  END IF;

  SELECT f.id, f.status, f.competition_id, f.home_team_id, f.away_team_id, s.league_id
  INTO v_fixture
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  WHERE f.id = p_fixture_id;

  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.league_id <> v_league_id THEN
    RAISE EXCEPTION 'fixture_not_in_league' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_status = 'postponed' THEN
    IF v_fixture.status NOT IN ('scheduled','allocated') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001', DETAIL = v_fixture.status || '->postponed';
    END IF;
    v_reason := NULLIF(trim(p_metadata->>'postpone_reason'), '');
    IF v_reason IS NULL THEN RAISE EXCEPTION 'postpone_reason_required' USING ERRCODE = 'P0001'; END IF;
    UPDATE fixtures SET status='postponed', postpone_reason=v_reason WHERE id=p_fixture_id;
    v_broadcast_reason := 'fixture_postponed';

  ELSIF p_new_status = 'void' THEN
    IF v_fixture.status NOT IN ('scheduled','allocated','postponed') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001', DETAIL = v_fixture.status || '->void';
    END IF;
    v_reason := NULLIF(trim(p_metadata->>'void_reason'), '');
    IF v_reason IS NULL THEN RAISE EXCEPTION 'void_reason_required' USING ERRCODE = 'P0001'; END IF;
    UPDATE fixtures SET status='void', void_reason=v_reason WHERE id=p_fixture_id;
    v_broadcast_reason := 'fixture_voided';

  ELSIF p_new_status = 'walkover' THEN
    IF v_fixture.status NOT IN ('scheduled','allocated') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001', DETAIL = v_fixture.status || '->walkover';
    END IF;
    v_winner := NULLIF(trim(p_metadata->>'winner_team_id'), '');
    IF v_winner IS NULL THEN RAISE EXCEPTION 'winner_team_id_required' USING ERRCODE = 'P0001'; END IF;
    IF v_winner <> v_fixture.home_team_id AND (v_fixture.away_team_id IS NULL OR v_winner <> v_fixture.away_team_id) THEN
      RAISE EXCEPTION 'winner_not_in_fixture' USING ERRCODE = 'P0001', DETAIL = v_winner;
    END IF;
    UPDATE fixtures SET status='walkover', walkover_winner_id=v_winner WHERE id=p_fixture_id;
    v_broadcast_reason := 'fixture_walkover';

  ELSIF p_new_status = 'forfeit' THEN
    IF v_fixture.status NOT IN ('scheduled','allocated','completed') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001', DETAIL = v_fixture.status || '->forfeit';
    END IF;
    v_winner := NULLIF(trim(p_metadata->>'winner_team_id'), '');
    IF v_winner IS NULL THEN RAISE EXCEPTION 'winner_team_id_required' USING ERRCODE = 'P0001'; END IF;
    IF v_winner <> v_fixture.home_team_id AND (v_fixture.away_team_id IS NULL OR v_winner <> v_fixture.away_team_id) THEN
      RAISE EXCEPTION 'winner_not_in_fixture' USING ERRCODE = 'P0001', DETAIL = v_winner;
    END IF;
    v_reason := NULLIF(trim(p_metadata->>'forfeit_reason'), '');
    IF v_reason IS NULL THEN RAISE EXCEPTION 'forfeit_reason_required' USING ERRCODE = 'P0001'; END IF;
    UPDATE fixtures SET status='forfeit', forfeit_winner_id=v_winner, forfeit_reason=v_reason WHERE id=p_fixture_id;
    v_broadcast_reason := 'fixture_forfeit';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_fixture.home_team_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    v_broadcast_reason, 'fixture', p_fixture_id::text,
    jsonb_build_object('competition_id', v_fixture.competition_id, 'league_id', v_league_id,
                       'previous_status', v_fixture.status, 'new_status', p_new_status, 'metadata', p_metadata)
  );

  PERFORM public.notify_league_change(v_league_id, 'fixture_status_changed');
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id, v_broadcast_reason); END IF;
  PERFORM public.notify_team_change(v_fixture.home_team_id, 'fixture_status_changed');
  IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id, 'fixture_status_changed'); END IF;

  RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id, 'status', p_new_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.league_update_fixture_status(text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.league_update_fixture_status(text, uuid, text, jsonb) TO anon, authenticated;
