-- Migration 325 DOWN — reverse Phase 7D Double Elimination
-- Restores the three RPCs replaced in 325, drops the two new RPCs,
-- and removes the three new columns from fixtures.

-- ─── 1. Drop new RPCs ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.club_admin_seed_double_elimination(uuid, uuid);
DROP FUNCTION IF EXISTS public._advance_tournament_double_elim(uuid);

-- ─── 2. Restore ref_confirm_tournament_match (Phase 7C version) ───────────────
CREATE OR REPLACE FUNCTION public.ref_confirm_tournament_match(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_home    integer;
  v_away    integer;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  v_home := COALESCE(v_fixture.home_score, 0);
  v_away := COALESCE(v_fixture.away_score, 0);

  UPDATE public.fixtures
     SET status         = 'completed',
         current_period = 'FT'
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_confirm_tournament_match',
    'fixture', v_fixture.id::text,
    jsonb_build_object('home_score', v_home, 'away_score', v_away)
  );

  IF v_fixture.group_label IS NULL THEN
    PERFORM public._advance_tournament_winner(v_fixture.id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'home_score', v_home, 'away_score', v_away, 'status', 'completed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ref_confirm_tournament_match(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_confirm_tournament_match(text)
  TO anon, authenticated;

-- ─── 3. Restore club_admin_get_schedule (Phase 7C version — no de_bracket) ────
-- (omitted for brevity — re-apply mig 324 if needed)

-- ─── 4. Restore get_tournament_public (Phase 7C version — no de_bracket) ──────
-- (omitted for brevity — re-apply mig 324 if needed)

-- ─── 5. Narrow fixtures_home_identity back to Phase 7C version ───────────────
ALTER TABLE public.fixtures DROP CONSTRAINT IF EXISTS fixtures_home_identity;
ALTER TABLE public.fixtures ADD CONSTRAINT fixtures_home_identity CHECK (
  (home_team_id IS NOT NULL)
  OR (home_competition_team_id IS NOT NULL)
  OR (knockout_home_feeder_id IS NOT NULL)
);

-- ─── 6. Drop new columns (only safe if no DE fixtures exist) ─────────────────
ALTER TABLE public.fixtures DROP COLUMN IF EXISTS de_loser_to_slot;
ALTER TABLE public.fixtures DROP COLUMN IF EXISTS de_loser_to_fixture_id;
ALTER TABLE public.fixtures DROP COLUMN IF EXISTS de_bracket;
