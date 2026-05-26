-- 102_phase2_venue_withdraw_team.sql
--
-- Phase 2 (League Mode) — Cycle 2.5b mid-season team withdrawal.
--
--   venue_withdraw_team(p_venue_token, p_competition_team_id, p_reason)
--     Flips a pending or active competition_teams row to 'withdrawn'
--     AND cascades the team's remaining unplayed fixtures to
--     walkovers awarded to the opposing team.
--
-- Cascade rule (per session 48 audit decision):
--   - Targets fixtures WHERE status IN ('scheduled','allocated',
--     'postponed') AND (home_team_id = X OR away_team_id = X) in the
--     same competition.
--   - Real matchups (away_team_id IS NOT NULL): status='walkover',
--     walkover_winner_id = the OTHER team.
--   - Phantom byes (away_team_id IS NULL): status='void',
--     void_reason='team_withdrew'.
--   - Past results (completed/walkover/void/forfeit) untouched.
--
-- Idempotency: re-calling on an already-withdrawn row returns a
-- noop success without re-running cascade.
--
-- Audit: TWO rows — one for the team status flip, one for the bulk
-- cascade with metadata.fixture_count (mirrors mig 091 bulk-RPC rule).
-- Broadcasts: venue 'team_withdrew' + 'fixtures_cascaded';
-- league 'team_withdrew' + 'fixtures_cascaded'.
--
-- Returns:
--   { "ok": true, "competition_team_id": "<uuid>", "team_id": "...",
--     "competition_id": "<uuid>", "status": "withdrawn",
--     "cascaded_fixture_count": N }

CREATE OR REPLACE FUNCTION public.venue_withdraw_team(
  p_venue_token         text,
  p_competition_team_id uuid,
  p_reason              text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_row record;
  v_league_id text;
  v_reason text;
  v_walkover_count int := 0;
  v_void_count int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'competition_team_id_required' USING ERRCODE = 'P0001';
  END IF;

  v_reason := NULLIF(trim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'withdrawal_reason_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT ct.id, ct.status, ct.competition_id, ct.team_id,
         s.league_id, l.venue_id AS l_venue
  INTO v_row
  FROM competition_teams ct
  JOIN competitions c ON c.id = ct.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE ct.id = p_competition_team_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'registration_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.l_venue <> v_venue_id THEN
    RAISE EXCEPTION 'registration_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  v_league_id := v_row.league_id;

  IF v_row.status = 'withdrawn' THEN
    RETURN jsonb_build_object(
      'ok', true, 'competition_team_id', p_competition_team_id,
      'team_id', v_row.team_id, 'competition_id', v_row.competition_id,
      'status', 'withdrawn', 'noop', true, 'cascaded_fixture_count', 0
    );
  END IF;
  IF v_row.status NOT IN ('pending','active') THEN
    RAISE EXCEPTION 'invalid_registration_status' USING ERRCODE = 'P0001',
      DETAIL = v_row.status;
  END IF;

  -- 1. Flip team status
  UPDATE competition_teams
     SET status = 'withdrawn',
         withdrawal_reason = v_reason
   WHERE id = p_competition_team_id;

  -- 2. Cascade — real matchups → walkover to other team
  WITH updated AS (
    UPDATE fixtures f
       SET status = 'walkover',
           walkover_winner_id = CASE
             WHEN f.home_team_id = v_row.team_id THEN f.away_team_id
             ELSE f.home_team_id
           END
     WHERE f.competition_id = v_row.competition_id
       AND f.status IN ('scheduled','allocated','postponed')
       AND (f.home_team_id = v_row.team_id OR f.away_team_id = v_row.team_id)
       AND f.away_team_id IS NOT NULL
       AND f.home_team_id <> f.away_team_id  -- defensive
    RETURNING 1
  )
  SELECT count(*) INTO v_walkover_count FROM updated;

  -- 3. Cascade — phantom byes → void
  WITH updated AS (
    UPDATE fixtures f
       SET status = 'void',
           void_reason = 'team_withdrew'
     WHERE f.competition_id = v_row.competition_id
       AND f.status IN ('scheduled','allocated','postponed')
       AND f.home_team_id = v_row.team_id
       AND f.away_team_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_void_count FROM updated;

  -- 4. Audit (team-level + bulk cascade)
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'team_withdrew', 'competition_team', p_competition_team_id::text,
    jsonb_build_object(
      'team_id', v_row.team_id,
      'competition_id', v_row.competition_id,
      'league_id', v_league_id,
      'reason', v_reason
    )
  );

  IF (v_walkover_count + v_void_count) > 0 THEN
    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                              action, entity_type, entity_id, metadata)
    VALUES (
      v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
      'fixtures_cascaded', 'competition', v_row.competition_id::text,
      jsonb_build_object(
        'trigger', 'team_withdrew',
        'team_id', v_row.team_id,
        'competition_id', v_row.competition_id,
        'league_id', v_league_id,
        'walkover_count', v_walkover_count,
        'void_count', v_void_count
      )
    );
  END IF;

  -- 5. Broadcast
  PERFORM public.notify_venue_change(v_venue_id, 'team_withdrew');
  PERFORM public.notify_league_change(v_league_id, 'team_withdrew');
  IF (v_walkover_count + v_void_count) > 0 THEN
    PERFORM public.notify_venue_change(v_venue_id, 'fixtures_cascaded');
    PERFORM public.notify_league_change(v_league_id, 'fixtures_cascaded');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'competition_team_id', p_competition_team_id,
    'team_id', v_row.team_id,
    'competition_id', v_row.competition_id,
    'status', 'withdrawn',
    'cascaded_fixture_count', v_walkover_count + v_void_count,
    'walkover_count', v_walkover_count,
    'void_count', v_void_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_withdraw_team(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_withdraw_team(text, uuid, text)
  TO anon, authenticated;
