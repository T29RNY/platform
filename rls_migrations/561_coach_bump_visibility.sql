-- 561_coach_bump_visibility.sql
-- Coach self-service pitch booking — Phase 3b (PR #3, split): bump-visibility rewrite.
--
-- Operator decision 5b (decouple session from pitch), applied to the SHIPPED bump
-- engine (migs 416-418). Today a bumped club event flips status='tentative', which
-- HIDES it from the player/guardian schedule readers (which filter status='scheduled')
-- and drags its already-cast RSVPs. This rewrite makes a bumped CLUB_SESSION signal
-- the bump on its decoupled `pitch_status` instead, keeping status='scheduled' — so
-- the session stays visible ("pitch being confirmed"), keeps its RSVPs, and a
-- move/accept just re-points the pitch (decision D = carry the in/outs, for free).
--
-- TWO shipped functions change, club_session arm ONLY (surgical):
--   * _reserve_club_occupancy  — on a bump, set the incumbent club_session
--                                pitch_status='requested' (keep status='scheduled')
--                                instead of status='tentative'.
--   * _apply_bump_resolution   — accept: move the session AND set pitch_status='allocated'
--                                so the trigger re-reserves; decline: set the session
--                                pitch_status='none' ("pitch TBC", coach re-picks).
--
-- UNCHANGED (operator-confirmed sub-decision): club_FIXTURES have no pitch_status
-- column, so their bump/accept/decline arms keep the status='tentative'/'scheduled'
-- behaviour byte-for-byte. Both functions keep the LIVE signature, grants and
-- search_path; the club_fixture arms and every non-bump line match the live
-- (mig-417-lineage) bodies pulled from pg_proc — only the club_session arms change.
-- No client call-site changes (both are internal `_`-prefixed SECDEF helpers).
--
-- ⚠️ READER COUPLING (surfaced by review, operator-acknowledged): NO reader surfaces
-- club_sessions.pitch_status yet, so between this apply and the reader PR (#4), a
-- bumped/declined session stays status='scheduled' and renders at its now-lost slot
-- as if confirmed. This apply is therefore COUPLED to the pitch_status reader change
-- (surface "pitch being confirmed"/"pitch TBC", suppress the stale slot) — apply 561
-- WITH that reader PR, not ahead of it, on the live owner-bump path.
--
-- Occupancy correctness: the bump's step 1 already explicitly releases the incumbent's
-- occupancy (`UPDATE pitch_occupancy SET active=false`), so the slot is free for the
-- winner regardless of the trigger. Setting pitch_status (not in the occupancy
-- trigger's `UPDATE OF status,venue_id,playing_area_id,scheduled_at` list) does NOT
-- re-fire the trigger — which is correct here (nothing left to release). On accept,
-- the moved playing_area_id/scheduled_at ARE in that list, so the trigger fires and,
-- with pitch_status='allocated', re-reserves at the new slot (re-activating the same
-- pitch_occupancy row via _upsert's ON CONFLICT (source_kind, source_id)).
--
-- Proof: ephemeral-verify (throwaway _e2e_ fixture, auto-rollback, leak 0) MUST show:
--   (1) club-vs-club bump → incumbent SESSION stays status='scheduled', pitch_status
--       ='requested', holds NO occupancy; winner reserved; a pending proposal exists;
--   (2) accept → session moves to the suggested slot, pitch_status='allocated', occupancy
--       re-reserved at the new slot, status STILL 'scheduled', proposal 'accepted';
--   (3) decline → session status='scheduled', pitch_status='none' (pitch TBC), no
--       occupancy, proposal 'declined';
--   (4) club_FIXTURE bump → fixture status='tentative' (UNCHANGED regression);
--   (5) non-bumpable clash (external hire) → still 'slot_unavailable' (unchanged).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. _reserve_club_occupancy — bumped club_session keeps status, loses only pitch
-- ════════════════════════════════════════════════════════════════════════════
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

  -- The EXCLUDE constraint guarantees at most ONE active overlapping row on this pitch.
  SELECT * INTO v_conf FROM public.pitch_occupancy po
   WHERE po.playing_area_id = p_pitch AND po.active AND po.time_range && p_range
     AND NOT (po.source_kind = p_kind AND po.source_id = p_source_id)
   LIMIT 1;

  IF v_conf.id IS NULL THEN
    PERFORM public._upsert_club_occupancy(p_kind, p_source_id, p_pitch, p_venue, p_range);
    RETURN;
  END IF;

  -- Bumping is club-vs-club ONLY — never evict an outside hire / league fixture / maintenance.
  IF v_conf.source_kind NOT IN ('club_session','club_fixture') THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_conf.source_kind = 'club_session' THEN
    SELECT team_id INTO v_loser_team FROM public.club_sessions WHERE id = v_conf.source_id::uuid;
  ELSE
    SELECT club_team_id INTO v_loser_team FROM public.club_fixtures WHERE id = v_conf.source_id::uuid;
  END IF;
  SELECT priority_rank INTO v_loser_rank FROM public.club_teams WHERE id = v_loser_team;

  -- Rank decides, not arrival. Incoming wins ONLY if both ranks are set and incoming is
  -- strictly better (lower number). Equal / NULL / worse → today's behaviour, no bump.
  IF v_incoming_rank IS NULL OR v_loser_rank IS NULL OR v_incoming_rank >= v_loser_rank THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- ── BUMP the incumbent ──────────────────────────────────────────────────
  v_loser_dur := (extract(epoch FROM (upper(v_conf.time_range) - lower(v_conf.time_range))) / 60)::int;

  -- 1) release the incumbent's pitch
  UPDATE public.pitch_occupancy SET active = false WHERE id = v_conf.id;

  -- 2) signal the bump WITHOUT hiding the session (decision 5b). A bumped club_session
  --    keeps status='scheduled' and moves only its PITCH state to 'requested', so it
  --    stays in the player/guardian schedule readers and its RSVPs stay attached — the
  --    occupancy was already released in step 1 (pitch_status is not in the occupancy
  --    trigger's UPDATE OF list, so this UPDATE does not re-fire it, which is correct:
  --    nothing left to release). club_fixtures have no pitch_status → keep 'tentative'.
  IF v_conf.source_kind = 'club_session' THEN
    UPDATE public.club_sessions SET pitch_status = 'requested' WHERE id = v_conf.source_id::uuid;
    SELECT club_id INTO v_club FROM public.club_sessions WHERE id = v_conf.source_id::uuid;
  ELSE
    UPDATE public.club_fixtures SET status = 'tentative' WHERE id = v_conf.source_id::uuid;
    SELECT club_id INTO v_club FROM public.club_teams WHERE id = v_loser_team;
  END IF;

  -- 3) reserve the WINNER first, so its slot is excluded from the suggestion search
  PERFORM public._upsert_club_occupancy(p_kind, p_source_id, p_pitch, p_venue, p_range);

  -- 4) compute the closest alternative for the bumped team (winner now occupies the slot)
  v_sugg := public._closest_available_slot(
              v_conf.source_kind, v_loser_team, v_loser_rank,
              v_conf.playing_area_id, v_conf.venue_id, lower(v_conf.time_range), v_loser_dur);

  -- 5) supersede any prior pending proposal for this event, then store the new one
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

  -- 6) notify the bumped team (reuse comms spine) + audit
  PERFORM public._notify_bump(v_prop_id);
END;
$fn$;
REVOKE ALL     ON FUNCTION public._reserve_club_occupancy(text, text, uuid, text, tstzrange, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public._reserve_club_occupancy(text, text, uuid, text, tstzrange, uuid) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. _apply_bump_resolution — accept re-allocates the pitch; decline → pitch TBC
-- ════════════════════════════════════════════════════════════════════════════
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
    -- Coach declined the suggested alternative. A club_session stays alive
    -- (status='scheduled') with its pitch cleared to 'none' = pitch TBC (coach
    -- re-picks); the occupancy was already released at bump time. club_fixtures
    -- keep the tentative signal (no pitch_status column) — unchanged.
    IF p.event_kind = 'club_session' THEN
      UPDATE public.club_sessions SET pitch_status = 'none' WHERE id = p.event_id;
    END IF;
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

  -- Try to move the event onto the suggested slot. The event's trigger re-reserves occupancy
  -- and raises slot_unavailable if it was taken in the meantime → we re-suggest, stay pending.
  BEGIN
    IF p.event_kind = 'club_session' THEN
      -- Move the session AND re-allocate the pitch. status stays 'scheduled' throughout
      -- (decoupled model — RSVPs kept); pitch_status flips 'requested'→'allocated' so the
      -- trigger (fired by the moved playing_area_id/scheduled_at) actually reserves the slot.
      UPDATE public.club_sessions
        SET status = 'scheduled', pitch_status = 'allocated',
            playing_area_id = p.suggested_playing_area_id,
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
