-- Down for migration 187 — Phase 11 cup advancement.
-- Drops the trigger + advancement + new RPCs, and restores ref_confirm_full_time to its
-- pre-11.2 body (mig pre-187: always completes from goal events, no cup branch).

DROP TRIGGER IF EXISTS cup_advance_after_result ON public.fixtures;
DROP FUNCTION IF EXISTS public.tg_cup_advance();
DROP FUNCTION IF EXISTS public._cup_advance(uuid);
DROP FUNCTION IF EXISTS public.ref_record_knockout_decider(text, int, int, int, int, text);
DROP FUNCTION IF EXISTS public.venue_schedule_cup_tie(text, uuid, date, time, uuid);

CREATE OR REPLACE FUNCTION public.ref_confirm_full_time(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_home int; v_away int; v_venue_id text;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;
  SELECT
    COUNT(*) FILTER (WHERE event_type='goal' AND team_id = v_fixture.home_team_id)
   +COUNT(*) FILTER (WHERE event_type='own_goal' AND team_id = v_fixture.away_team_id),
    COUNT(*) FILTER (WHERE event_type='goal' AND team_id = v_fixture.away_team_id)
   +COUNT(*) FILTER (WHERE event_type='own_goal' AND team_id = v_fixture.home_team_id)
  INTO v_home, v_away FROM public.match_events WHERE fixture_id = v_fixture.id;
  UPDATE public.fixtures SET status='completed', home_score = v_home, away_score = v_away WHERE id = v_fixture.id;
  INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
  VALUES (v_fixture.home_team_id,'referee',p_ref_token,'ref_confirm_full_time','fixture',v_fixture.id::text,
    jsonb_build_object('home_team_id',v_fixture.home_team_id,'away_team_id',v_fixture.away_team_id,'home_score',v_home,'away_score',v_away));
  PERFORM public.notify_team_change(v_fixture.home_team_id,'match_result_saved');
  IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_result_saved'); END IF;
  v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_result_saved'); END IF;
  RETURN jsonb_build_object('ok',true,'fixture_id',v_fixture.id,'home_score',v_home,'away_score',v_away,'status','completed');
END;
$function$;
