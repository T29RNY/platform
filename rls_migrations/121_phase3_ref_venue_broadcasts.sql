-- 121_phase3_ref_venue_broadcasts.sql
--
-- Phase 3 (League Mode) — Cycle 3.2 follow-on.
--
-- Cycle 3.2 (mig 120) added the seven ref live-match RPCs and wired
-- realtime broadcasts to BOTH teams via the existing notify_team_change
-- → team_live:<live_channel_key> pipeline. That makes the apps/inorout
-- team-admin tab update silently when a ref taps goal.
--
-- The venue admin watching the apps/venue dashboard from the office
-- DOESN'T subscribe to any team channel — different surface, different
-- token. So today, ref taps don't update the venue dashboard. This
-- migration adds a venue-level broadcast so the operator's dashboard
-- updates live too.
--
-- Design:
--
-- 1. New helper `notify_venue_change(p_venue_id, p_reason)` — mirror
--    of notify_team_change but uses `venues.live_channel_key` and
--    publishes on the `venue_live:<key>` channel. Same private=false
--    (public) so anon clients (the venue admin opens the dashboard
--    with their venue_admin_token, which already exposes the channel
--    key via venue_get_state) can subscribe. Same RAISE WARNING on
--    unknown reason. Whitelist starts with the 3 reasons Phase 3 uses
--    and can grow.
--
-- 2. Replace all 7 ref_* RPCs to also call notify_venue_change after
--    the team broadcasts. The venue_id is derived from the fixture
--    via competition → season → league → venue. One extra SELECT per
--    RPC body.
--
-- 3. No new client surface yet — apps/venue's App.jsx subscriber is
--    a separate JS change in the same commit.

-- ──────────────────────────────────────────────────────────────────
-- 1. notify_venue_change
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    -- Phase 3 ref events (mig 121)
    'match_started',
    'match_event_recorded',
    'match_result_saved'
    -- additions live here; document each in the calling RPC's commit
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_venue_change: unknown reason "%" for venue "%"',
      p_reason, p_venue_id;
  END IF;

  SELECT live_channel_key INTO v_channel_key
  FROM venues WHERE id = p_venue_id;

  IF v_channel_key IS NULL THEN RETURN; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type',   'venue_state_changed',
      'reason', p_reason,
      'at',     extract(epoch from now())
    ),
    'broadcast',
    'venue_live:' || v_channel_key,
    false  -- public broadcast (channel-key is the secret)
  );
END;
$function$;

-- Helper not for client use; the 7 ref RPCs call it via SECURITY DEFINER.
REVOKE ALL     ON FUNCTION public.notify_venue_change(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_venue_change(text, text) FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 2. Tiny helper — venue_id from a fixture (saves repeating the join
--    in each of the 7 RPCs)
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._ref_venue_id_for_fixture(p_fixture public.fixtures)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT l.venue_id
  FROM competitions c
  JOIN seasons s ON s.id = c.season_id
  JOIN leagues l ON l.id = s.league_id
  WHERE c.id = p_fixture.competition_id
$function$;
REVOKE ALL     ON FUNCTION public._ref_venue_id_for_fixture(public.fixtures) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._ref_venue_id_for_fixture(public.fixtures) FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 3. Re-create all 7 ref RPCs with the extra venue broadcast call.
--    Bodies are byte-identical to mig 120 except for the trailing
--    `PERFORM public.notify_venue_change(...)` line right after the
--    away-team broadcast.
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ref_start_match(
  p_ref_token       text,
  p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_event_id uuid; v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status NOT IN ('scheduled','allocated') THEN
    RAISE EXCEPTION 'fixture_status_locks_start' USING ERRCODE='P0001', DETAIL=v_fixture.status;
  END IF;
  UPDATE public.fixtures SET status='in_progress', actual_kickoff_at=p_local_timestamp WHERE id=v_fixture.id;
  INSERT INTO public.match_events (fixture_id,team_id,event_type,minute,period,recorded_by_token,recorded_by_type,local_timestamp,synced_at,client_event_id)
  VALUES (v_fixture.id,v_fixture.home_team_id,'period_change',0,'1H',p_ref_token,'referee',p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
  VALUES (v_fixture.home_team_id,'referee',p_ref_token,'ref_start_match','fixture',v_fixture.id::text,
    jsonb_build_object('competition_id',v_fixture.competition_id,'home_team_id',v_fixture.home_team_id,'away_team_id',v_fixture.away_team_id,'actual_kickoff_at',p_local_timestamp,'client_event_id',p_client_event_id));
  PERFORM public.notify_team_change(v_fixture.home_team_id,'match_started');
  IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_started'); END IF;
  v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_started'); END IF;
  RETURN jsonb_build_object('ok',true,'fixture_id',v_fixture.id,'actual_kickoff_at',p_local_timestamp,'event_id',v_event_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ref_record_goal(
  p_ref_token text, p_player_id text, p_minute integer, p_period text,
  p_client_event_id uuid, p_own_goal boolean DEFAULT false,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_team_id text; v_event_id uuid; v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;
  SELECT pr.team_id INTO v_team_id FROM player_registrations pr
   WHERE pr.player_id = p_player_id AND pr.competition_id = v_fixture.competition_id
     AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id,'')) LIMIT 1;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'player_not_in_fixture' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.match_events (fixture_id,team_id,player_id,event_type,minute,period,recorded_by_token,recorded_by_type,local_timestamp,synced_at,client_event_id)
  VALUES (v_fixture.id,v_team_id,p_player_id, CASE WHEN p_own_goal THEN 'own_goal' ELSE 'goal' END, p_minute,p_period,p_ref_token,'referee',p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_team_id,'referee',p_ref_token, CASE WHEN p_own_goal THEN 'ref_record_own_goal' ELSE 'ref_record_goal' END, 'match_event',v_event_id::text,
      jsonb_build_object('fixture_id',v_fixture.id,'player_id',p_player_id,'minute',p_minute,'period',p_period,'client_event_id',p_client_event_id,'own_goal',p_own_goal));
    PERFORM public.notify_team_change(v_fixture.home_team_id,'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_event_recorded'); END IF;
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_event_recorded'); END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'team_id',v_team_id,'duplicate',v_event_id IS NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ref_record_card(
  p_ref_token text, p_player_id text, p_minute integer, p_period text,
  p_colour text, p_client_event_id uuid, p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_team_id text; v_event_type text; v_event_id uuid; v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_colour NOT IN ('yellow','red') THEN RAISE EXCEPTION 'invalid_card_colour' USING ERRCODE='P0001', DETAIL=p_colour; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;
  SELECT pr.team_id INTO v_team_id FROM player_registrations pr
   WHERE pr.player_id = p_player_id AND pr.competition_id = v_fixture.competition_id
     AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id,'')) LIMIT 1;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'player_not_in_fixture' USING ERRCODE='P0001'; END IF;
  v_event_type := p_colour || '_card';
  INSERT INTO public.match_events (fixture_id,team_id,player_id,event_type,minute,period,recorded_by_token,recorded_by_type,local_timestamp,synced_at,client_event_id)
  VALUES (v_fixture.id,v_team_id,p_player_id,v_event_type,p_minute,p_period,p_ref_token,'referee',p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_team_id,'referee',p_ref_token,'ref_record_card','match_event',v_event_id::text,
      jsonb_build_object('fixture_id',v_fixture.id,'player_id',p_player_id,'colour',p_colour,'minute',p_minute,'period',p_period,'client_event_id',p_client_event_id));
    PERFORM public.notify_team_change(v_fixture.home_team_id,'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_event_recorded'); END IF;
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_event_recorded'); END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'team_id',v_team_id,'duplicate',v_event_id IS NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ref_record_substitution(
  p_ref_token text, p_on_player_id text, p_off_player_id text,
  p_minute integer, p_period text, p_client_event_id uuid,
  p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_on_team text; v_off_team text; v_event_id uuid; v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_on_player_id IS NULL OR p_off_player_id IS NULL THEN RAISE EXCEPTION 'missing_substitution_players' USING ERRCODE='P0001'; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;
  SELECT pr.team_id INTO v_on_team FROM player_registrations pr
   WHERE pr.player_id = p_on_player_id AND pr.competition_id = v_fixture.competition_id
     AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id,'')) LIMIT 1;
  SELECT pr.team_id INTO v_off_team FROM player_registrations pr
   WHERE pr.player_id = p_off_player_id AND pr.competition_id = v_fixture.competition_id
     AND pr.team_id IN (v_fixture.home_team_id, COALESCE(v_fixture.away_team_id,'')) LIMIT 1;
  IF v_on_team IS NULL OR v_off_team IS NULL OR v_on_team <> v_off_team THEN RAISE EXCEPTION 'substitution_team_mismatch' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.match_events (fixture_id,team_id,event_type,minute,period,sub_player_on_id,sub_player_off_id,recorded_by_token,recorded_by_type,local_timestamp,synced_at,client_event_id)
  VALUES (v_fixture.id,v_on_team,'substitution',p_minute,p_period,p_on_player_id,p_off_player_id,p_ref_token,'referee',p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_on_team,'referee',p_ref_token,'ref_record_substitution','match_event',v_event_id::text,
      jsonb_build_object('fixture_id',v_fixture.id,'on_player_id',p_on_player_id,'off_player_id',p_off_player_id,'minute',p_minute,'period',p_period,'client_event_id',p_client_event_id));
    PERFORM public.notify_team_change(v_fixture.home_team_id,'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_event_recorded'); END IF;
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_event_recorded'); END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'team_id',v_on_team,'duplicate',v_event_id IS NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ref_set_period(
  p_ref_token text, p_period text, p_client_event_id uuid, p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_event_id uuid; v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_period NOT IN ('HT','2H','ET1','ET2','PEN') THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001', DETAIL=p_period; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;
  INSERT INTO public.match_events (fixture_id,team_id,event_type,minute,period,recorded_by_token,recorded_by_type,local_timestamp,synced_at,client_event_id)
  VALUES (v_fixture.id,v_fixture.home_team_id,'period_change',0,p_period,p_ref_token,'referee',p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_fixture.home_team_id,'referee',p_ref_token,'ref_set_period','fixture',v_fixture.id::text,
      jsonb_build_object('period',p_period,'client_event_id',p_client_event_id));
    PERFORM public.notify_team_change(v_fixture.home_team_id,'match_event_recorded');
    IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_event_recorded'); END IF;
    v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
    IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_event_recorded'); END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'period',p_period,'duplicate',v_event_id IS NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ref_undo_event(p_ref_token text, p_client_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_fixture public.fixtures; v_event public.match_events; v_venue_id text;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  v_fixture := public._ref_resolve_fixture(p_ref_token);
  IF v_fixture.status <> 'in_progress' THEN RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE='P0001', DETAIL=v_fixture.status; END IF;
  SELECT * INTO v_event FROM public.match_events WHERE fixture_id = v_fixture.id AND client_event_id = p_client_event_id;
  IF v_event.id IS NULL THEN RETURN jsonb_build_object('ok',true,'noop',true); END IF;
  DELETE FROM public.match_events WHERE id = v_event.id;
  INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
  VALUES (v_event.team_id,'referee',p_ref_token,'ref_undo_event','match_event',v_event.id::text,
    jsonb_build_object('fixture_id',v_fixture.id,'event_type',v_event.event_type,'player_id',v_event.player_id,'minute',v_event.minute,'period',v_event.period,'client_event_id',p_client_event_id));
  PERFORM public.notify_team_change(v_fixture.home_team_id,'match_event_recorded');
  IF v_fixture.away_team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_fixture.away_team_id,'match_event_recorded'); END IF;
  v_venue_id := public._ref_venue_id_for_fixture(v_fixture);
  IF v_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(v_venue_id,'match_event_recorded'); END IF;
  RETURN jsonb_build_object('ok',true,'removed_event_id',v_event.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ref_confirm_full_time(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
