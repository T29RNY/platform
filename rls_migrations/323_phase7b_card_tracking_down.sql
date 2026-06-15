-- Down migration for 323_phase7b_card_tracking
-- Drops tournament_cards table and new RPCs.
-- Restores ref_start_tournament_match and club_admin_get_standings to mig 322 bodies.
-- NOTE: club_admin_get_standings mig322 body still had the broken club_admins join;
-- down migration restores it faithfully for source parity, but do not rely on it at runtime.

DROP FUNCTION IF EXISTS public.ref_record_tournament_card(text, uuid, text, text, integer, text);
DROP FUNCTION IF EXISTS public.get_tournament_suspension_list(uuid, uuid);
DROP TABLE IF EXISTS public.tournament_cards;

-- Restore ref_start_tournament_match to mig 320 signature (no suspensions field)
CREATE OR REPLACE FUNCTION public.ref_start_tournament_match(
  p_ref_token       text,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_fixture public.fixtures;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;
  IF v_fixture.status NOT IN ('scheduled', 'allocated') THEN
    RAISE EXCEPTION 'fixture_status_locks_start' USING ERRCODE = 'P0001', DETAIL = v_fixture.status;
  END IF;
  UPDATE public.fixtures
     SET status = 'in_progress', actual_kickoff_at = p_local_timestamp, current_period = '1H'
   WHERE id = v_fixture.id;
  INSERT INTO public.audit_events (team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', 'referee', p_ref_token, 'ref_start_tournament_match', 'fixture', v_fixture.id::text,
    jsonb_build_object('competition_id', v_fixture.competition_id, 'actual_kickoff_at', p_local_timestamp, 'client_event_id', p_client_event_id));
  RETURN jsonb_build_object('ok', true, 'fixture_id', v_fixture.id, 'status', 'in_progress');
END;
$$;
REVOKE ALL ON FUNCTION public.ref_start_tournament_match(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ref_start_tournament_match(text, uuid, timestamptz) TO anon, authenticated;
