-- 490_self_serve_enter_result.sql
--
-- Standalone Tournament Self-Serve epic — PR #4, the ONE net-new score RPC.
--
-- Live round-robin/group standings already recompute from fixtures.home_score/
-- away_score inside get_tournament_public, and a venue-token fixture-score writer
-- already exists. The ONE genuine gap is tournament KNOCKOUT advancement:
-- _advance_tournament_winner (mig 187) / _advance_tournament_double_elim (mig 325)
-- are internal SECDEF helpers triggered today ONLY by ref_confirm_tournament_match
-- (a ref-token path). A self-serve organiser has no ref token — they enter the
-- final score directly, pitch-side, from their phone.
--
-- self_serve_enter_result sets a fixture's FINAL score AND advances the bracket,
-- in one transaction. It is the direct-entry twin of ref_confirm_tournament_match:
--   * ref path: a live clock accumulates the score, ref confirms → advance.
--   * self-serve path: the organiser types the final score → complete → advance.
-- Direct final-score entry (not live goal-by-goal) is the correct altitude for a
-- mate on a touchline; the full ref console stays available for organisers who
-- want it.
--
-- AUTH: reuses the Stage-1b venue_id-as-token pattern via
-- _authorise_venue_tournament(venue_id, tournament_event_id) — the tournament's
-- venue_id is passed in the token slot and re-checked against auth.uid() on every
-- call, so a bystander passing someone else's venue_id is rejected
-- (invalid_venue_token / not_authorised). No new auth surface, zero twins. The
-- tournament_event_id is DERIVED server-side from the fixture, never trusted from
-- the client.
--
-- SAFE: the advance helpers are internal SECDEF (REVOKEd from PUBLIC/anon/
-- authenticated) callable only from inside another SECDEF — this RPC PERFORMs
-- them exactly as ref_confirm_tournament_match does. A completed fixture is
-- blocked from re-entry so the bracket can never double-advance (score
-- CORRECTION after completion is a deferred edge case, not a v1 need).

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
  -- Score validation
  IF p_home IS NULL OR p_away IS NULL OR p_home < 0 OR p_away < 0 THEN
    RAISE EXCEPTION 'invalid_score' USING ERRCODE = 'P0001';
  END IF;
  IF p_home > 999 OR p_away > 999 THEN
    RAISE EXCEPTION 'invalid_score' USING ERRCODE = 'P0001';
  END IF;

  -- FOR UPDATE: lock the fixture row so two concurrent entries can't both pass
  -- the completed-check below and double-advance the bracket.
  SELECT * INTO v_fx FROM public.fixtures WHERE id = p_fixture_id FOR UPDATE;
  IF v_fx.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Must be a fully-drawn tournament fixture — BOTH competition-team slots filled.
  -- Scoring a half-seeded knockout slot would propagate a NULL team forward.
  IF v_fx.home_competition_team_id IS NULL OR v_fx.away_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  -- Derive the tournament from the fixture's competition (never trust the client)
  SELECT c.tournament_event_id INTO v_te_id
  FROM public.competitions c
  WHERE c.id = v_fx.competition_id;
  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  -- Authorise: caller owns this tournament's venue (Stage-1b re-checks auth.uid()).
  -- Raises invalid_venue_token / not_authorised on any mismatch.
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te_id);

  -- Block re-entry on an already-completed fixture — prevents double-advance.
  IF v_fx.status = 'completed' THEN
    RAISE EXCEPTION 'result_already_entered' USING ERRCODE = 'P0001';
  END IF;

  -- A knockout fixture (no group_label) has no valid draw: the advance helpers
  -- self-return on home=away, which would mark this fixture completed but never
  -- fill the next round, stranding the bracket with no correction path (re-entry
  -- is blocked above). Reject it before writing anything — the organiser must
  -- enter a decisive score (shootouts are resolved to a decisive score off-app).
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

  -- Advance the bracket — identical branch to ref_confirm_tournament_match (mig 325):
  --   group_label IS NOT NULL → group stage, no advancement (standings recompute)
  --   de_bracket  IS NOT NULL → double-elimination advance
  --   else                    → single-elimination advance
  -- The helpers re-read the fixture's (now updated) scores; a draw self-returns.
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

-- Grants: authenticated-only. Strip PUBLIC and the auto-granted anon explicitly.
REVOKE ALL ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) TO authenticated;
