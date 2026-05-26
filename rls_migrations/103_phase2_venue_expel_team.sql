-- 103_phase2_venue_expel_team.sql
--
-- Phase 2 (League Mode) — Cycle 2.5b mid-season team expulsion.
--
--   venue_expel_team(p_venue_token, p_competition_team_id, p_reason)
--     Disciplinary counterpart of venue_withdraw_team. Flips an
--     active competition_teams row to 'expelled' AND cascades the
--     team's remaining unplayed fixtures identically to withdrawal
--     (walkover to opposing team; void on phantom byes).
--
-- Differs from withdraw in:
--   - Source statuses allowed: active only (you can't expel a
--     pending registration — reject it instead).
--   - Target status: 'expelled'.
--   - Reason column: expulsion_reason (mig 101).
--   - Audit action + broadcast reason: 'team_expelled'.
--   - The cascaded fixtures' void_reason is 'team_expelled' (vs
--     'team_withdrew') so the operator can distinguish them later.
--
-- Cascade rule, idempotency, audit shape (2 rows), and broadcast
-- topology mirror mig 102 exactly.
--
-- Returns:
--   { "ok": true, "competition_team_id": "<uuid>", "team_id": "...",
--     "competition_id": "<uuid>", "status": "expelled",
--     "cascaded_fixture_count": N }

CREATE OR REPLACE FUNCTION public.venue_expel_team(
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
    RAISE EXCEPTION 'expulsion_reason_required' USING ERRCODE = 'P0001';
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

  IF v_row.status = 'expelled' THEN
    RETURN jsonb_build_object(
      'ok', true, 'competition_team_id', p_competition_team_id,
      'team_id', v_row.team_id, 'competition_id', v_row.competition_id,
      'status', 'expelled', 'noop', true, 'cascaded_fixture_count', 0
    );
  END IF;
  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'only_active_can_be_expelled' USING ERRCODE = 'P0001',
      DETAIL = v_row.status;
  END IF;

  UPDATE competition_teams
     SET status = 'expelled',
         expulsion_reason = v_reason
   WHERE id = p_competition_team_id;

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
       AND f.home_team_id <> f.away_team_id
    RETURNING 1
  )
  SELECT count(*) INTO v_walkover_count FROM updated;

  WITH updated AS (
    UPDATE fixtures f
       SET status = 'void',
           void_reason = 'team_expelled'
     WHERE f.competition_id = v_row.competition_id
       AND f.status IN ('scheduled','allocated','postponed')
       AND f.home_team_id = v_row.team_id
       AND f.away_team_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_void_count FROM updated;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'team_expelled', 'competition_team', p_competition_team_id::text,
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
        'trigger', 'team_expelled',
        'team_id', v_row.team_id,
        'competition_id', v_row.competition_id,
        'league_id', v_league_id,
        'walkover_count', v_walkover_count,
        'void_count', v_void_count
      )
    );
  END IF;

  PERFORM public.notify_venue_change(v_venue_id, 'team_expelled');
  PERFORM public.notify_league_change(v_league_id, 'team_expelled');
  IF (v_walkover_count + v_void_count) > 0 THEN
    PERFORM public.notify_venue_change(v_venue_id, 'fixtures_cascaded');
    PERFORM public.notify_league_change(v_league_id, 'fixtures_cascaded');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'competition_team_id', p_competition_team_id,
    'team_id', v_row.team_id,
    'competition_id', v_row.competition_id,
    'status', 'expelled',
    'cascaded_fixture_count', v_walkover_count + v_void_count,
    'walkover_count', v_walkover_count,
    'void_count', v_void_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_expel_team(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_expel_team(text, uuid, text)
  TO anon, authenticated;
