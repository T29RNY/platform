-- 099_phase2_venue_approve_team_registration.sql
--
-- Phase 2 (League Mode) — Cycle 2.5a venue admin approval RPC.
--
--   venue_approve_team_registration(p_venue_token, p_competition_team_id)
--     Flips a pending competition_teams row to 'active'. Idempotent:
--     re-approving an already-active registration is a no-op success
--     (so a double-click on the operator dashboard doesn't 500).
--
-- Validation:
--   - Caller resolves to venue (resolve_venue_caller)
--   - competition_teams row exists AND its competition→season→league
--     belongs to caller's venue
--   - Current status IN ('pending','active'). Any other terminal
--     state (rejected/withdrawn/expelled) requires un-doing the
--     terminal action first — out of scope here.
--
-- Behaviour:
--   - status → 'active'
--   - rejection_reason cleared (defensive — should be NULL on
--     pending rows anyway)
--   - Single audit row; venue broadcast 'team_approved' +
--     league broadcast 'team_approved'
--
-- Notification delivery to the team admin (email/push) is owned by
-- Cycle 2.7. This RPC just ensures the audit + broadcast hooks fire
-- so the dispatcher has something to subscribe to.
--
-- Returns:
--   { "ok": true,
--     "competition_team_id": "<uuid>",
--     "team_id": "team_xxx",
--     "competition_id": "<uuid>",
--     "status": "active" }

CREATE OR REPLACE FUNCTION public.venue_approve_team_registration(
  p_venue_token        text,
  p_competition_team_id uuid
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
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'competition_team_id_required' USING ERRCODE = 'P0001';
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
  IF v_row.status NOT IN ('pending','active') THEN
    RAISE EXCEPTION 'invalid_registration_status' USING ERRCODE = 'P0001',
      DETAIL = v_row.status;
  END IF;
  v_league_id := v_row.league_id;

  -- Idempotent no-op if already active
  IF v_row.status = 'active' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'competition_team_id', p_competition_team_id,
      'team_id', v_row.team_id,
      'competition_id', v_row.competition_id,
      'status', 'active',
      'noop', true
    );
  END IF;

  UPDATE competition_teams
     SET status = 'active',
         rejection_reason = NULL
   WHERE id = p_competition_team_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'team_approved', 'competition_team', p_competition_team_id::text,
    jsonb_build_object(
      'team_id', v_row.team_id,
      'competition_id', v_row.competition_id,
      'league_id', v_league_id
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'team_approved');
  PERFORM public.notify_league_change(v_league_id, 'team_approved');

  RETURN jsonb_build_object(
    'ok', true,
    'competition_team_id', p_competition_team_id,
    'team_id', v_row.team_id,
    'competition_id', v_row.competition_id,
    'status', 'active'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_approve_team_registration(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_approve_team_registration(text, uuid)
  TO anon, authenticated;
