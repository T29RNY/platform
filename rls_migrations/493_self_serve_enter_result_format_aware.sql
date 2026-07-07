-- 493_self_serve_enter_result_format_aware.sql
--
-- Standalone Tournament Self-Serve epic — PR #4b, correctness amend to mig 490.
--
-- THE BUG (surfaced by PR #4b's round-robin support): mig 490 used
-- `group_label IS NULL` as its sole knockout signal — it rejects a draw
-- (knockout_cannot_draw) and runs the advance engine for ANY group_label-NULL
-- fixture. That was correct while the only self-serve fixtures were knockouts.
-- But PR #4b lets an organiser generate a ROUND-ROBIN (venue_generate_schedule),
-- whose fixtures ALSO have group_label NULL — and round-robin draws are legal and
-- common (esp. football). Under mig 490, scoring a round-robin draw fails with
-- knockout_cannot_draw. (Decisive round-robin results happened to work: the
-- advance helper self-returns when a fixture has no knockout feeders.)
--
-- No existing writer fills the gap: venue_update_fixture_result (mig 127) is
-- LEAGUE-mode (JOINs seasons→leagues; self-serve competitions have season_id NULL
-- → fixture_not_found) and is an edit-of-completed path. So self_serve_enter_result
-- must itself be format-aware.
--
-- THE FIX: derive the competition FORMAT alongside tournament_event_id and treat a
-- fixture as a knockout tie iff it has no group_label AND its competition is NOT
-- round_robin. This preserves every prior behaviour:
--   * single_elimination / double_elimination → group_label NULL → knockout
--     (draw rejected, bracket advanced) — unchanged.
--   * group_stage GROUP fixtures → group_label set → not knockout (draws OK, no
--     advance) — unchanged.
--   * group_stage KNOCKOUT fixtures → group_label NULL, format<>round_robin →
--     knockout — unchanged.
--   * round_robin → group_label NULL, format=round_robin → NOT knockout: draws
--     allowed, no advance, standings recompute from the score — FIXED.
--
-- Same signature as mig 490 → CREATE OR REPLACE (no new overload, no DROP needed).

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
  v_fx           public.fixtures;
  v_te_id        uuid;
  v_comp_format  text;
  v_auth         record;
  v_home         integer := p_home;
  v_away         integer := p_away;
  v_is_knockout  boolean;
BEGIN
  -- Score validation
  IF p_home IS NULL OR p_away IS NULL OR p_home < 0 OR p_away < 0 THEN
    RAISE EXCEPTION 'invalid_score' USING ERRCODE = 'P0001';
  END IF;
  IF p_home > 999 OR p_away > 999 THEN
    RAISE EXCEPTION 'invalid_score' USING ERRCODE = 'P0001';
  END IF;

  -- FOR UPDATE: lock the fixture so two concurrent entries can't both pass the
  -- completed-check and double-advance the bracket.
  SELECT * INTO v_fx FROM public.fixtures WHERE id = p_fixture_id FOR UPDATE;
  IF v_fx.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Must be a fully-drawn tournament fixture — BOTH competition-team slots filled.
  IF v_fx.home_competition_team_id IS NULL OR v_fx.away_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  -- Derive the tournament AND the competition format (never trust the client).
  SELECT c.tournament_event_id, c.format INTO v_te_id, v_comp_format
  FROM public.competitions c
  WHERE c.id = v_fx.competition_id;
  IF v_te_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  -- Authorise: caller owns this tournament's venue (Stage-1b re-checks auth.uid()).
  SELECT * INTO v_auth FROM public._authorise_venue_tournament(p_venue_token, v_te_id);

  -- Block re-entry on an already-completed fixture — prevents double-advance.
  IF v_fx.status = 'completed' THEN
    RAISE EXCEPTION 'result_already_entered' USING ERRCODE = 'P0001';
  END IF;

  -- Knockout tie iff no group label AND the competition isn't a plain round-robin.
  -- (round_robin fixtures are group_label-NULL too, but they never advance and may
  -- legally draw.)
  v_is_knockout := (v_fx.group_label IS NULL AND COALESCE(v_comp_format, '') <> 'round_robin');

  -- A knockout tie has no valid draw: the advance helpers self-return on home=away,
  -- which would mark the fixture completed but never fill the next round, stranding
  -- the bracket with no correction path (re-entry is blocked above). Reject before
  -- writing. Round-robin / group fixtures may draw freely.
  IF v_is_knockout AND v_home = v_away THEN
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
      'tournament_event_id', v_te_id, 'competition_id', v_fx.competition_id,
      'is_knockout', v_is_knockout
    )
  );

  -- Advance only a knockout tie. Round-robin / group standings recompute from the
  -- score inside get_tournament_public — no advancement.
  IF v_is_knockout THEN
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

-- Grants unchanged (authenticated-only); re-assert defensively after REPLACE.
REVOKE ALL ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_enter_result(text, uuid, integer, integer) TO authenticated;
