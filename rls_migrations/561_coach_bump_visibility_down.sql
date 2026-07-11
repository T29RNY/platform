-- 561_coach_bump_visibility_down.sql — reverse of 561.
-- Restores _reserve_club_occupancy + _apply_bump_resolution to their pre-561 LIVE
-- behaviour (bodies pulled from pg_proc): a bumped club_session flips status='tentative'
-- again; accept moves without touching pitch_status; decline leaves the session
-- tentative. club_fixture arms were never changed. (These match the live mig-417-lineage
-- bodies behaviourally; whitespace/comments are normalised, not byte-for-byte.)

CREATE OR REPLACE FUNCTION public._reserve_club_occupancy(
  p_kind text, p_source_id text, p_pitch uuid, p_venue text, p_range tstzrange, p_team_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_incoming_rank int;
  v_conf          record;
  v_loser_team    uuid;
  v_loser_rank    int;
  v_loser_dur     int;
  v_club          text;
  v_sugg          jsonb;
  v_prop_id       uuid;
BEGIN
  SELECT priority_rank INTO v_incoming_rank FROM public.club_teams WHERE id = p_team_id;

  SELECT * INTO v_conf FROM public.pitch_occupancy po
   WHERE po.playing_area_id = p_pitch AND po.active AND po.time_range && p_range
     AND NOT (po.source_kind = p_kind AND po.source_id = p_source_id)
   LIMIT 1;

  IF v_conf.id IS NULL THEN
    PERFORM public._upsert_club_occupancy(p_kind, p_source_id, p_pitch, p_venue, p_range);
    RETURN;
  END IF;

  IF v_conf.source_kind NOT IN ('club_session','club_fixture') THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_conf.source_kind = 'club_session' THEN
    SELECT team_id INTO v_loser_team FROM public.club_sessions WHERE id = v_conf.source_id::uuid;
  ELSE
    SELECT club_team_id INTO v_loser_team FROM public.club_fixtures WHERE id = v_conf.source_id::uuid;
  END IF;
  SELECT priority_rank INTO v_loser_rank FROM public.club_teams WHERE id = v_loser_team;

  IF v_incoming_rank IS NULL OR v_loser_rank IS NULL OR v_incoming_rank >= v_loser_rank THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  v_loser_dur := (extract(epoch FROM (upper(v_conf.time_range) - lower(v_conf.time_range))) / 60)::int;

  UPDATE public.pitch_occupancy SET active = false WHERE id = v_conf.id;

  IF v_conf.source_kind = 'club_session' THEN
    UPDATE public.club_sessions SET status = 'tentative' WHERE id = v_conf.source_id::uuid;
    SELECT club_id INTO v_club FROM public.club_sessions WHERE id = v_conf.source_id::uuid;
  ELSE
    UPDATE public.club_fixtures SET status = 'tentative' WHERE id = v_conf.source_id::uuid;
    SELECT club_id INTO v_club FROM public.club_teams WHERE id = v_loser_team;
  END IF;

  PERFORM public._upsert_club_occupancy(p_kind, p_source_id, p_pitch, p_venue, p_range);

  v_sugg := public._closest_available_slot(
              v_conf.source_kind, v_loser_team, v_loser_rank,
              v_conf.playing_area_id, v_conf.venue_id, lower(v_conf.time_range), v_loser_dur);

  UPDATE public.pitch_bump_proposals SET status = 'superseded', resolved_at = now()
    WHERE event_kind = v_conf.source_kind AND event_id = v_conf.source_id::uuid AND status = 'pending';

  INSERT INTO public.pitch_bump_proposals
    (event_kind, event_id, club_team_id, club_id,
     original_playing_area_id, original_venue_id, original_start,
     suggested_playing_area_id, suggested_venue_id, suggested_start,
     bumped_by_kind, bumped_by_id, status)
  VALUES
    (v_conf.source_kind, v_conf.source_id::uuid, v_loser_team, v_club,
     v_conf.playing_area_id, v_conf.venue_id, lower(v_conf.time_range),
     NULLIF(v_sugg->>'playing_area_id','')::uuid, v_sugg->>'venue_id', (v_sugg->>'start')::timestamptz,
     p_kind, p_source_id, 'pending')
  RETURNING id INTO v_prop_id;

  PERFORM public._notify_bump(v_prop_id);
END;
$fn$;
REVOKE ALL     ON FUNCTION public._reserve_club_occupancy(text, text, uuid, text, tstzrange, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public._reserve_club_occupancy(text, text, uuid, text, tstzrange, uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._apply_bump_resolution(
  p_proposal_id uuid, p_action text, p_actor_type text, p_actor_ident text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  p        record;
  v_rank   int;
  v_sugg   jsonb;
BEGIN
  SELECT * INTO p FROM public.pitch_bump_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'proposal_not_pending' USING ERRCODE = 'P0001'; END IF;

  IF p_action = 'decline' THEN
    UPDATE public.pitch_bump_proposals SET status = 'declined', resolved_at = now() WHERE id = p_proposal_id;
    INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES ('_system', auth.uid(), p_actor_type, p_actor_ident, 'pitch_bump_declined', 'pitch_bump_proposal', p_proposal_id::text,
      jsonb_build_object('event_kind', p.event_kind, 'event_id', p.event_id, 'club_team_id', p.club_team_id));
    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  IF p_action <> 'accept' THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE = 'P0001'; END IF;
  IF p.suggested_start IS NULL OR p.suggested_playing_area_id IS NULL THEN
    RAISE EXCEPTION 'no_suggestion' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    IF p.event_kind = 'club_session' THEN
      UPDATE public.club_sessions
        SET status = 'scheduled', playing_area_id = p.suggested_playing_area_id,
            venue_id = p.suggested_venue_id, scheduled_at = p.suggested_start
        WHERE id = p.event_id;
    ELSE
      UPDATE public.club_fixtures
        SET status = 'scheduled', playing_area_id = p.suggested_playing_area_id,
            scheduled_date = (p.suggested_start AT TIME ZONE 'Europe/London')::date,
            kickoff_time   = (p.suggested_start AT TIME ZONE 'Europe/London')::time
        WHERE id = p.event_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'slot_unavailable' THEN
      SELECT priority_rank INTO v_rank FROM public.club_teams WHERE id = p.club_team_id;
      v_sugg := public._closest_available_slot(p.event_kind, p.club_team_id, v_rank,
                  p.original_playing_area_id, p.original_venue_id, p.original_start, 60);
      UPDATE public.pitch_bump_proposals
        SET suggested_playing_area_id = NULLIF(v_sugg->>'playing_area_id','')::uuid,
            suggested_venue_id        = v_sugg->>'venue_id',
            suggested_start           = (v_sugg->>'start')::timestamptz
        WHERE id = p_proposal_id;
      INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
      VALUES ('_system', auth.uid(), p_actor_type, p_actor_ident, 'pitch_bump_resuggested', 'pitch_bump_proposal', p_proposal_id::text,
        jsonb_build_object('event_kind', p.event_kind, 'event_id', p.event_id, 'new_suggestion', v_sugg));
      RETURN jsonb_build_object('ok', false, 'retry', true, 'reason', 'slot_taken', 'suggestion', v_sugg);
    END IF;
    RAISE;
  END;

  UPDATE public.pitch_bump_proposals SET status = 'accepted', resolved_at = now() WHERE id = p_proposal_id;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', auth.uid(), p_actor_type, p_actor_ident, 'pitch_bump_accepted', 'pitch_bump_proposal', p_proposal_id::text,
    jsonb_build_object('event_kind', p.event_kind, 'event_id', p.event_id, 'club_team_id', p.club_team_id,
      'moved_to_pitch', p.suggested_playing_area_id, 'moved_to_start', p.suggested_start));
  IF p.original_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(p.original_venue_id, 'pitch_bump_resolved'); END IF;
  IF p.suggested_venue_id IS NOT NULL AND p.suggested_venue_id <> COALESCE(p.original_venue_id,'') THEN
    PERFORM public.notify_venue_change(p.suggested_venue_id, 'pitch_bump_resolved');
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 'accepted',
    'playing_area_id', p.suggested_playing_area_id, 'start', p.suggested_start);
END;
$fn$;
REVOKE ALL     ON FUNCTION public._apply_bump_resolution(uuid, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public._apply_bump_resolution(uuid, text, text, text) FROM anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
