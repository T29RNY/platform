-- Migration 152 — Pitch Booking Stage 7B: renewal right-of-first-refusal RPCs +
-- push-admin resolver + get_team_bookings series fields.
--   create_renewal_holds()        — cron (service-role): reserve next block for ending series.
--   confirm_renewal(p_series_id)   — casual (authenticated): "keep my slot" → hold -> requested.
--   expire_renewal_holds()         — cron (service-role): release lapsed holds.
--   get_team_admin_player_ids(...) — service-role: push targeting (team admins' player ids).
--   get_team_bookings(...)         — CREATE OR REPLACE adding series status/renewal fields.
-- Holds use pitch_bookings.status='hold' + active occupancy priority 2 (genuine reservation).
-- Renewal needs venue re-approval: confirm flips hold->requested (NOT confirmed); the venue
-- then approves via the existing venue_confirm_booking inbox path.

-- ── 1. create_renewal_holds — service-role (cron) ──────────────────
CREATE OR REPLACE FUNCTION public.create_renewal_holds()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  s          record;
  v_weeks    int;
  v_first    date;       -- first held week (origin ends_on + 7)
  v_renewal  uuid;
  v_bid      uuid;
  v_i        int;
  v_date     date;
  v_start    timestamptz;
  v_expires  timestamptz;
  v_held     jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
BEGIN
  FOR s IN
    SELECT bs.* FROM booking_series bs
    WHERE bs.status = 'active'
      AND bs.ends_on IS NOT NULL
      AND bs.ends_on BETWEEN current_date AND current_date + 21
      AND NOT EXISTS (SELECT 1 FROM booking_series r WHERE r.renewal_of_series_id = bs.id)
  LOOP
    -- mirror the original block length exactly (no cap), from its booked span
    SELECT GREATEST(1, ((s.ends_on - MIN(b.booking_date)) / 7) + 1)
      INTO v_weeks
    FROM pitch_bookings b WHERE b.series_id = s.id AND b.kind = 'block';
    v_weeks  := COALESCE(v_weeks, 1);
    v_first  := s.ends_on + 7;
    v_expires := LEAST(now() + interval '7 days',
                       ((v_first::timestamp) AT TIME ZONE 'Europe/London') - interval '1 day');
    v_renewal := gen_random_uuid();

    BEGIN
      UPDATE booking_series SET status = 'ending' WHERE id = s.id;

      INSERT INTO booking_series (id, team_id, venue_id, playing_area_id, day_of_week,
                                  kickoff_time, slot_minutes, status, ends_on,
                                  renewal_of_series_id, hold_expires_at)
      VALUES (v_renewal, s.team_id, s.venue_id, s.playing_area_id, s.day_of_week,
              s.kickoff_time, s.slot_minutes, 'active', v_first + (v_weeks - 1) * 7,
              s.id, v_expires);

      FOR v_i IN 0 .. (v_weeks - 1) LOOP
        v_date  := v_first + v_i * 7;
        v_start := (v_date + s.kickoff_time) AT TIME ZONE 'Europe/London';
        v_bid   := gen_random_uuid();
        INSERT INTO pitch_bookings (id, team_id, venue_id, playing_area_id, booking_date,
                                    kickoff_time, slot_minutes, kind, status, series_id)
        VALUES (v_bid, s.team_id, s.venue_id, s.playing_area_id, v_date,
                s.kickoff_time, s.slot_minutes, 'block', 'hold', v_renewal);
        INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind,
                                     source_id, priority, active)
        VALUES (s.playing_area_id, s.venue_id,
                tstzrange(v_start, v_start + make_interval(mins => COALESCE(s.slot_minutes, 60)), '[)'),
                'booking', v_bid::text, 2, true);
      END LOOP;

      INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                                action, entity_type, entity_id, metadata)
      VALUES (s.team_id, NULL, 'system', 'cron:renewal_holds', 'booking_renewal_held',
              'booking_series', v_renewal::text,
              jsonb_build_object('origin_series_id', s.id, 'venue_id', s.venue_id,
                                 'weeks', v_weeks, 'first_week', v_first, 'hold_expires_at', v_expires));

      PERFORM public.notify_venue_change(s.venue_id, 'booking_renewal_held');
      PERFORM public.notify_team_change(s.team_id, 'booking_renewal_held');

      v_held := v_held || jsonb_build_object('team_id', s.team_id, 'origin_series_id', s.id,
                  'renewal_series_id', v_renewal, 'weeks', v_weeks, 'first_week', v_first,
                  'hold_expires_at', v_expires);
    EXCEPTION WHEN exclusion_violation THEN
      -- renewal slot already taken (fixture/other booking) → skip; origin stays 'active'
      v_skipped := v_skipped || jsonb_build_object('origin_series_id', s.id, 'reason', 'slot_unavailable');
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'holds', v_held, 'skipped', v_skipped);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_renewal_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_renewal_holds() TO service_role;

-- ── 2. confirm_renewal — authenticated (casual "keep my slot") ─────
CREATE OR REPLACE FUNCTION public.confirm_renewal(p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s   record;
  v_n   int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_s FROM booking_series WHERE id = p_series_id;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_s.renewal_of_series_id IS NULL THEN RAISE EXCEPTION 'not_a_renewal_hold' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = v_s.team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not_team_admin' USING ERRCODE = 'P0001';
  END IF;
  IF v_s.hold_expires_at IS NOT NULL AND v_s.hold_expires_at < now() THEN
    RAISE EXCEPTION 'renewal_lapsed' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pitch_bookings WHERE series_id = p_series_id AND status = 'hold') THEN
    RAISE EXCEPTION 'renewal_lapsed' USING ERRCODE = 'P0001';
  END IF;

  -- Right-of-first-refusal: claim the held weeks as requests (occupancy already held).
  -- Venue re-approves via the existing inbox / venue_confirm_booking.
  UPDATE pitch_bookings SET status = 'requested' WHERE series_id = p_series_id AND status = 'hold';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE booking_series SET hold_expires_at = NULL WHERE id = p_series_id;
  UPDATE booking_series SET status = 'cancelled' WHERE id = v_s.renewal_of_series_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_s.team_id, v_uid, 'team_admin', 'user_id:' || v_uid::text, 'booking_requested',
          'booking_series', p_series_id::text,
          jsonb_build_object('venue_id', v_s.venue_id, 'renewal', true, 'weeks', v_n,
                             'origin_series_id', v_s.renewal_of_series_id));

  PERFORM public.notify_venue_change(v_s.venue_id, 'booking_requested');
  PERFORM public.notify_team_change(v_s.team_id, 'booking_requested');

  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id, 'weeks', v_n, 'status', 'requested');
END;
$function$;
REVOKE ALL ON FUNCTION public.confirm_renewal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_renewal(uuid) TO authenticated;

-- ── 3. expire_renewal_holds — service-role (cron) ──────────────────
CREATE OR REPLACE FUNCTION public.expire_renewal_holds()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  s         record;
  v_expired jsonb := '[]'::jsonb;
BEGIN
  FOR s IN
    SELECT bs.* FROM booking_series bs
    WHERE bs.renewal_of_series_id IS NOT NULL
      AND bs.status = 'active'
      AND bs.hold_expires_at IS NOT NULL
      AND bs.hold_expires_at < now()
      AND EXISTS (SELECT 1 FROM pitch_bookings b WHERE b.series_id = bs.id AND b.status = 'hold')
  LOOP
    UPDATE pitch_occupancy SET active = false
      WHERE source_kind = 'booking'
        AND source_id IN (SELECT id::text FROM pitch_bookings WHERE series_id = s.id AND status = 'hold');
    UPDATE pitch_bookings SET status = 'expired' WHERE series_id = s.id AND status = 'hold';
    UPDATE booking_series SET status = 'cancelled' WHERE id = s.id;

    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                              action, entity_type, entity_id, metadata)
    VALUES (s.team_id, NULL, 'system', 'cron:renewal_expire', 'booking_renewal_expired',
            'booking_series', s.id::text,
            jsonb_build_object('venue_id', s.venue_id, 'origin_series_id', s.renewal_of_series_id));

    PERFORM public.notify_venue_change(s.venue_id, 'booking_renewal_expired');
    PERFORM public.notify_team_change(s.team_id, 'booking_renewal_expired');

    v_expired := v_expired || jsonb_build_object('team_id', s.team_id, 'renewal_series_id', s.id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'expired', v_expired);
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_renewal_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_renewal_holds() TO service_role;

-- ── 4. get_team_admin_player_ids — service-role (push targeting) ───
CREATE OR REPLACE FUNCTION public.get_team_admin_player_ids(p_team_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(p.id), '[]'::jsonb) INTO v_result
  FROM players p
  JOIN team_players tp ON tp.player_id = p.id
  WHERE tp.team_id = p_team_id
    AND p.user_id IN (SELECT user_id FROM team_admins WHERE team_id = p_team_id AND revoked_at IS NULL);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_team_admin_player_ids(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_admin_player_ids(text) TO service_role;

-- ── 5. get_team_bookings — add series/renewal fields (CREATE OR REPLACE) ──
CREATE OR REPLACE FUNCTION public.get_team_bookings(p_team_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = p_team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not_team_admin' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'booking_id', b.id,
    'status', b.status,
    'kind', b.kind,
    'booking_date', b.booking_date,
    'kickoff_time', b.kickoff_time,
    'slot_minutes', b.slot_minutes,
    'series_id', b.series_id,
    'series_status', bs.status,
    'series_ends_on', bs.ends_on,
    'is_renewal_hold', (bs.renewal_of_series_id IS NOT NULL),
    'hold_expires_at', bs.hold_expires_at,
    'amount_pence', b.amount_pence,
    'payment_status', b.payment_status,
    'venue_id', b.venue_id,
    'venue_name', v.name,
    'venue_slug', v.slug,
    'venue_city', v.city,
    'cancellation_policy', v.cancellation_policy,
    'playing_area_id', b.playing_area_id,
    'pitch_name', pa.name
  ) ORDER BY b.booking_date, b.kickoff_time), '[]'::jsonb)
  INTO v_result
  FROM pitch_bookings b
  JOIN venues v ON v.id = b.venue_id
  JOIN playing_areas pa ON pa.id = b.playing_area_id
  LEFT JOIN booking_series bs ON bs.id = b.series_id
  WHERE b.team_id = p_team_id
    AND b.booking_date >= current_date - 30;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_team_bookings(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_bookings(text) TO authenticated;
