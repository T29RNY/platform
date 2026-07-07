-- 493_self_serve_enter_result_format_aware_down.sql
-- Reverse of 493: restore the mig-490 group_label-only self_serve_enter_result
-- (round-robin draws will again be rejected as knockout_cannot_draw).
CREATE OR REPLACE FUNCTION public.self_serve_enter_result(
  p_venue_token text,
  p_fixture_id  uuid,
  p_home        integer,
  p_away        integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_fx    public.fixtures;
  v_te_id uuid;
  v_auth  record;
  v_home  integer := p_home;
  v_away  integer := p_away;
BEGIN
  IF p_home IS NULL OR p_away IS NULL OR p_home < 0 OR p_away < 0 THEN
    RAISE EXCEPTION 'invalid_score' USING ERRCODE = 'P0001';
  END IF;
  IF p_home > 999 OR p_away > 999 THEN
    RAISE EXCEPTION 'invalid_score' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_fx FROM public.fixtures WHERE id = p_fixture_id FOR UPDATE;
  IF v_fx.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_fx.home_competition_team_id IS NULL OR v_fx.away_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.tournament_event_id INTO v_te_id
  FROM public.competitions c
  WHERE c.id = v_fx.competition_id;
  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te_id);

  IF v_fx.status = 'completed' THEN
    RAISE EXCEPTION 'result_already_entered' USING ERRCODE = 'P0001';
  END IF;

  IF v_fx.group_label IS NULL AND v_home = v_away THEN
    RAISE EXCEPTION 'knockout_cannot_draw' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.fixtures
     SET home_score     = v_home,
         away_score     = v_away,
         status         = 'completed',
         current_period = 'FT'
   WHERE id = v_fx.id;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    COALESCE(v_auth.club_id, v_auth.venue_id), auth.uid(), v_auth.actor_type, v_auth.actor_ident,
    'tournament_self_serve_result', 'fixture', v_fx.id::text,
    jsonb_build_object(
      'home_score', v_home, 'away_score', v_away,
      'tournament_event_id', v_te_id, 'competition_id', v_fx.competition_id
    )
  );

  IF v_fx.group_label IS NULL THEN
    IF v_fx.de_bracket IS NOT NULL THEN
      PERFORM public._advance_tournament_double_elim(v_fx.id);
    ELSE
      PERFORM public._advance_tournament_winner(v_fx.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'fixture_id', v_fx.id,
    'home_score', v_home,
    'away_score', v_away,
    'status', 'completed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) TO authenticated;
