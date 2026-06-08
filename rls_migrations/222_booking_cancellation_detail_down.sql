-- Down for migration 222 — restore cancel_booking to its mig-146 2-arg form
-- and drop the cancellations log reader.

DROP FUNCTION IF EXISTS public.venue_list_cancellations(text, int);
DROP FUNCTION IF EXISTS public.cancel_booking(uuid, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id  uuid,
  p_venue_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bk record;
  v_caller record;
  v_uid uuid := auth.uid();
  v_actor_type text;
  v_actor_ident text;
BEGIN
  SELECT * INTO v_bk FROM pitch_bookings WHERE id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001'; END IF;

  IF p_venue_token IS NOT NULL THEN
    SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
    IF v_caller IS NULL OR v_caller.venue_id IS NULL OR v_caller.venue_id <> v_bk.venue_id THEN
      RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
    END IF;
    v_actor_type := v_caller.actor_type; v_actor_ident := v_caller.actor_ident;
  ELSE
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
    IF v_bk.team_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = v_bk.team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0001';
    END IF;
    v_actor_type := 'team_admin'; v_actor_ident := 'user_id:' || v_uid::text;
  END IF;

  IF v_bk.status NOT IN ('requested','confirmed') THEN
    RAISE EXCEPTION 'booking_not_cancellable' USING ERRCODE = 'P0001', DETAIL = v_bk.status;
  END IF;

  UPDATE pitch_bookings SET status = 'cancelled' WHERE id = p_booking_id;
  UPDATE pitch_occupancy SET active = false WHERE source_kind = 'booking' AND source_id = p_booking_id::text;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_bk.venue_id), v_uid, v_actor_type, v_actor_ident, 'booking_cancelled', 'pitch_booking', p_booking_id::text,
    jsonb_build_object('venue_id', v_bk.venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id,
                       'by', CASE WHEN p_venue_token IS NOT NULL THEN 'venue' ELSE 'team' END));

  PERFORM public.notify_venue_change(v_bk.venue_id, 'booking_cancelled');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_cancelled'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'cancelled');
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text) TO anon, authenticated;
