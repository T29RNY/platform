-- 100_phase2_venue_reject_team_registration.sql
--
-- Phase 2 (League Mode) — Cycle 2.5a venue admin rejection RPC.
--
--   venue_reject_team_registration(p_venue_token, p_competition_team_id,
--                                  p_reason)
--     Flips a pending competition_teams row to 'rejected' with a
--     required reason captured in competition_teams.rejection_reason
--     (added in mig 097).
--
-- Validation:
--   - Caller resolves to venue (resolve_venue_caller)
--   - competition_teams row exists AND its competition→season→league
--     belongs to caller's venue
--   - Current status = 'pending' — once active/rejected/withdrawn/
--     expelled, this RPC won't touch it (different surfaces handle
--     re-evaluation or withdrawal)
--   - p_reason non-empty (the team admin needs to know why)
--
-- Behaviour:
--   - status → 'rejected'
--   - rejection_reason set to trimmed p_reason
--   - Single audit row; venue + league broadcasts 'team_rejected'
--
-- Notification delivery to the team admin (email/push) is Cycle 2.7's
-- job.
--
-- Returns:
--   { "ok": true, "competition_team_id": "<uuid>", "team_id": "team_xxx",
--     "competition_id": "<uuid>", "status": "rejected" }

CREATE OR REPLACE FUNCTION public.venue_reject_team_registration(
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
    RAISE EXCEPTION 'rejection_reason_required' USING ERRCODE = 'P0001';
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
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'only_pending_can_be_rejected' USING ERRCODE = 'P0001',
      DETAIL = v_row.status;
  END IF;
  v_league_id := v_row.league_id;

  UPDATE competition_teams
     SET status = 'rejected',
         rejection_reason = v_reason
   WHERE id = p_competition_team_id;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'team_rejected', 'competition_team', p_competition_team_id::text,
    jsonb_build_object(
      'team_id', v_row.team_id,
      'competition_id', v_row.competition_id,
      'league_id', v_league_id,
      'reason', v_reason
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'team_rejected');
  PERFORM public.notify_league_change(v_league_id, 'team_rejected');

  RETURN jsonb_build_object(
    'ok', true,
    'competition_team_id', p_competition_team_id,
    'team_id', v_row.team_id,
    'competition_id', v_row.competition_id,
    'status', 'rejected'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_reject_team_registration(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_reject_team_registration(text, uuid, text)
  TO anon, authenticated;
