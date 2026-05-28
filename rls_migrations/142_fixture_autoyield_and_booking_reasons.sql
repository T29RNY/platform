-- Migration 142 — Pitch Booking Stage 2b (venue-owned).
-- 1. Fixture-mirror trigger gains AUTO-YIELD: when a fixture claims a slot,
--    release overlapping UN-CONFIRMED (requested/held) lower-priority bookings
--    (active=false, status='superseded', notify both channels) before
--    inserting the fixture occupancy. Confirmed bookings are NOT auto-yielded
--    (the venue confirmed-clash gate in mig 143 owns that approval).
-- 2. Add the five booking_* reasons to BOTH notify_venue_change and
--    notify_team_change whitelists (explicit, to avoid the mig-121 WARNING
--    regression). booking_superseded fires here; the rest fire in Stage 4.

-- ── 1. fixture trigger + auto-yield ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sync_fixture_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_venue_id text;
  v_lc_slot  int;
  v_slot     int;
  v_start    timestamptz;
  v_range    tstzrange;
  v_bk       record;
BEGIN
  IF NEW.status IN ('scheduled','allocated','in_progress','completed')
     AND NEW.playing_area_id IS NOT NULL
     AND NEW.scheduled_date IS NOT NULL
     AND NEW.kickoff_time IS NOT NULL THEN

    SELECT l.venue_id, lc.slot_minutes
      INTO v_venue_id, v_lc_slot
    FROM competitions c
    JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id
    LEFT JOIN league_config lc ON lc.league_id = l.id
    WHERE c.id = NEW.competition_id;

    v_slot  := COALESCE(NEW.slot_minutes, v_lc_slot, 60);
    v_start := (NEW.scheduled_date + NEW.kickoff_time) AT TIME ZONE 'Europe/London';
    v_range := tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)');

    -- AUTO-YIELD: release overlapping un-confirmed lower-priority bookings
    FOR v_bk IN
      SELECT po.id AS occ_id, b.id AS booking_id, b.team_id, b.venue_id
      FROM pitch_occupancy po
      JOIN pitch_bookings b ON b.id = po.source_id::uuid
      WHERE po.playing_area_id = NEW.playing_area_id
        AND po.active
        AND po.source_kind = 'booking'
        AND po.priority > 1            -- lower priority than fixture (1)
        AND b.status = 'requested'     -- un-confirmed / held only
        AND po.time_range && v_range
    LOOP
      UPDATE pitch_occupancy SET active = false WHERE id = v_bk.occ_id;
      UPDATE pitch_bookings  SET status = 'superseded' WHERE id = v_bk.booking_id;
      PERFORM public.notify_venue_change(v_bk.venue_id, 'booking_superseded');
      IF v_bk.team_id IS NOT NULL THEN
        PERFORM public.notify_team_change(v_bk.team_id, 'booking_superseded');
      END IF;
    END LOOP;

    INSERT INTO public.pitch_occupancy (
      playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (NEW.playing_area_id, v_venue_id, v_range, 'fixture', NEW.id::text, 1, true)
    ON CONFLICT (source_kind, source_id) DO UPDATE
      SET playing_area_id = EXCLUDED.playing_area_id,
          venue_id        = EXCLUDED.venue_id,
          time_range      = EXCLUDED.time_range,
          priority        = 1,
          active          = true;
  ELSE
    UPDATE public.pitch_occupancy
       SET active = false
     WHERE source_kind = 'fixture' AND source_id = NEW.id::text;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2a. notify_venue_change — add booking_* reasons ──────────────────
CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    'venue_created','venue_updated','season_created','season_updated',
    'fixtures_generated','fixtures_cascaded','fixture_scheduled',
    'fixture_status_changed','fixture_postponed','fixture_voided',
    'fixture_walkover','fixture_forfeit','ref_assigned','ref_changed',
    'ref_no_show','ref_added','ref_updated','pitch_assigned','pitch_added',
    'pitch_updated','pitch_closed','team_registration_pending','team_approved',
    'team_rejected','team_withdrew','team_expelled','incident_flagged',
    'match_started','match_event_recorded','match_result_saved','result_corrected',
    -- Pitch booking (Stage 2b/4)
    'booking_requested','booking_confirmed','booking_declined',
    'booking_cancelled','booking_superseded'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_venue_change: unknown reason "%" for venue "%"', p_reason, p_venue_id;
  END IF;
  SELECT live_channel_key INTO v_channel_key FROM venues WHERE id = p_venue_id;
  IF v_channel_key IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    jsonb_build_object('type','venue_state_changed','reason',p_reason,'at',extract(epoch from now())),
    'broadcast', 'venue_live:' || v_channel_key, false);
END;
$function$;
REVOKE ALL     ON FUNCTION public.notify_venue_change(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_venue_change(text, text) FROM anon, authenticated;

-- ── 2b. notify_team_change — add booking_* reasons ───────────────────
CREATE OR REPLACE FUNCTION public.notify_team_change(p_team_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    'player_status_updated','player_paid_updated','player_injured_updated',
    'guest_player_added','guest_payment_updated','match_result_saved',
    'match_cancelled','match_teams_saved','match_bibs_saved','schedule_updated',
    'player_added','player_disabled','player_deleted','player_account_deleted',
    'player_vc_toggled','payment_confirmed','payment_reset','debt_cleared',
    'debt_waived','potm_vote_cast','player_enabled','settings_updated',
    'potm_voting_opened','potm_result_announced','player_note_updated',
    'player_updated','player_priority_updated','player_name_updated',
    'teams_confirmed','teams_draft_saved','game_live_toggled','game_cancelled',
    'match_teams_confirmed','guest_player_removed',
    -- Pitch booking (Stage 2b/4)
    'booking_requested','booking_confirmed','booking_declined',
    'booking_cancelled','booking_superseded'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_team_change: unknown reason "%" for team "%"', p_reason, p_team_id;
  END IF;
  SELECT live_channel_key INTO v_channel_key FROM teams WHERE id = p_team_id;
  IF v_channel_key IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    jsonb_build_object('type','team_state_changed','reason',p_reason,'at',extract(epoch from now())),
    'broadcast', 'team_live:' || v_channel_key, false);
END;
$function$;
