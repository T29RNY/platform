-- 095_phase2_venue_assign_ref.sql
--
-- Phase 2 (League Mode) — Cycle 2.4 fixture official (referee)
-- assignment RPC.
--
--   venue_assign_ref(p_venue_token, p_fixture_id, p_official_id)
--     Sets fixtures.official_id. Pass NULL official_id to clear
--     (e.g. ref no-show admin reassign workflow — clear, then call
--     again with the replacement).
--
-- Validation:
--   - Caller resolves to venue (resolve_venue_caller)
--   - Fixture exists AND its competition's league belongs to caller's venue
--   - Fixture.status IN ('scheduled','allocated') — officials can't be
--     reassigned on in-progress or terminal-status fixtures
--   - p_official_id (if non-NULL): belongs to caller's venue, active=true
--
-- Behaviour:
--   - Fixture.status is NOT auto-bumped by ref assignment. A pitch
--     is the trigger for 'allocated'; a ref is optional metadata on
--     top of that. Matches the session-48 design note that ref
--     assignment is independent of pitch allocation in the
--     operator UI.
--   - Audit action distinguishes assign vs change vs clear so the
--     activity log reads cleanly.
--
-- Returns:
--   { "ok": true, "fixture_id": "<uuid>", "official_id": "<uuid|null>" }

CREATE OR REPLACE FUNCTION public.venue_assign_ref(
  p_venue_token text,
  p_fixture_id  uuid,
  p_official_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_fixture record;
  v_league_id text;
  v_prev_official uuid;
  v_audit_action text;
  v_broadcast_reason text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'fixture_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.id, f.status, f.official_id, f.competition_id,
         s.league_id, l.venue_id AS l_venue
  INTO v_fixture
  FROM fixtures f
  JOIN competitions c ON c.id = f.competition_id
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE f.id = p_fixture_id;

  IF v_fixture.id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.l_venue <> v_venue_id THEN
    RAISE EXCEPTION 'fixture_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.status NOT IN ('scheduled','allocated') THEN
    RAISE EXCEPTION 'fixture_status_locks_ref' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;
  v_league_id := v_fixture.league_id;
  v_prev_official := v_fixture.official_id;

  IF p_official_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM match_officials
      WHERE id = p_official_id
        AND venue_id = v_venue_id
        AND active = true
    ) THEN
      RAISE EXCEPTION 'official_unavailable' USING ERRCODE = 'P0001',
        DETAIL = p_official_id::text;
    END IF;
  END IF;

  UPDATE fixtures
     SET official_id = p_official_id
   WHERE id = p_fixture_id;

  -- Pick action + broadcast reason
  IF v_prev_official IS NULL AND p_official_id IS NOT NULL THEN
    v_audit_action := 'fixture_ref_assigned';
    v_broadcast_reason := 'ref_assigned';
  ELSIF v_prev_official IS NOT NULL AND p_official_id IS NULL THEN
    v_audit_action := 'fixture_ref_cleared';
    v_broadcast_reason := 'ref_changed';
  ELSE
    v_audit_action := 'fixture_ref_changed';
    v_broadcast_reason := 'ref_changed';
  END IF;

  INSERT INTO audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    v_audit_action, 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'competition_id', v_fixture.competition_id,
      'league_id', v_league_id,
      'previous_official_id', v_prev_official,
      'official_id', p_official_id
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, v_broadcast_reason);

  RETURN jsonb_build_object(
    'ok', true,
    'fixture_id', p_fixture_id,
    'official_id', p_official_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_assign_ref(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_assign_ref(text, uuid, uuid)
  TO anon, authenticated;
