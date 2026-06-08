-- Migration 225 — live "ins" for venues (Phase B, cross-domain by explicit opt-in).
-- Lets a venue see, live, how many of a booked team's players are currently IN
-- for their session (e.g. 7/10), where target = the team's schedule.squad_size.
--
-- Boundary note: "ins" lives on the casual side (players.status). The venue only
-- ever receives COUNTS (never player identities) via a SECURITY DEFINER read,
-- and the live signal is a content-free 'booking_ins_changed' broadcast on the
-- venue's own channel. No casual identities cross to the venue UI.
--
-- Live mechanism: an AFTER UPDATE OF status trigger on players fires on EVERY
-- in/out change (player tap, admin set, weekly rollover, injury demotion) and
-- pings each venue where that team has an upcoming booking. Using a trigger (not
-- edits to set_player_status / admin_set_player_status) keeps the hot casual
-- toggle bodies untouched and catches all change sources from one place.

-- Ping every venue where the team has an upcoming booking that its ins changed.
-- Never raises — it runs inside the player-write path and must not break it.
CREATE OR REPLACE FUNCTION public.notify_booking_ins_for_team(p_team_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_venue text;
BEGIN
  FOR v_venue IN
    SELECT DISTINCT venue_id FROM pitch_bookings
     WHERE team_id = p_team_id
       AND status IN ('requested','confirmed')
       AND booking_date >= current_date AND booking_date < current_date + 14
  LOOP
    PERFORM public.notify_venue_change(v_venue, 'booking_ins_changed');
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_booking_ins_for_team(text) FROM PUBLIC;

-- Trigger glue: resolve the player's team(s) and ping their venues.
CREATE OR REPLACE FUNCTION public.trg_notify_booking_ins()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_team text;
BEGIN
  FOR v_team IN SELECT team_id FROM team_players WHERE player_id = NEW.id LOOP
    PERFORM public.notify_booking_ins_for_team(v_team);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS players_ins_notify ON public.players;
CREATE TRIGGER players_ins_notify
  AFTER UPDATE OF status ON public.players
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_notify_booking_ins();

-- Venue read: in-count + target per upcoming team booking (next 14 days).
-- Returns a map keyed by booking id so the schedule blocks can merge it in.
-- in = players IN & not disabled (mirrors the squad-cap count in set_player_status);
-- target = the team's active schedule.squad_size (null if unset).
CREATE OR REPLACE FUNCTION public.venue_get_booking_ins(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_map jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_object_agg(b.id::text, jsonb_build_object(
           'team_id', b.team_id, 'in_count', ic.in_count, 'target', sc.squad_size)), '{}'::jsonb)
    INTO v_map
  FROM pitch_bookings b
  JOIN LATERAL (
    SELECT COUNT(*) AS in_count
    FROM players p JOIN team_players tp ON tp.player_id = p.id
    WHERE tp.team_id = b.team_id AND p.status = 'in' AND NOT p.disabled
  ) ic ON true
  LEFT JOIN LATERAL (
    SELECT s.squad_size FROM schedule s WHERE s.team_id = b.team_id AND s.active = true LIMIT 1
  ) sc ON true
  WHERE b.venue_id = v_caller.venue_id
    AND b.team_id IS NOT NULL
    AND b.status IN ('requested','confirmed')
    AND b.booking_date >= current_date AND b.booking_date < current_date + 14;

  RETURN jsonb_build_object('ins', v_map);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_get_booking_ins(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_get_booking_ins(text) TO anon, authenticated;
