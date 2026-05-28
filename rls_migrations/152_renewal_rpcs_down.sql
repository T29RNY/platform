-- Down for migration 152. Drops the renewal RPCs + admin resolver and restores
-- get_team_bookings to its mig-148 body (no series/renewal fields).

DROP FUNCTION IF EXISTS public.create_renewal_holds();
DROP FUNCTION IF EXISTS public.confirm_renewal(uuid);
DROP FUNCTION IF EXISTS public.expire_renewal_holds();
DROP FUNCTION IF EXISTS public.get_team_admin_player_ids(text);

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
    'booking_id', b.id, 'status', b.status, 'kind', b.kind,
    'booking_date', b.booking_date, 'kickoff_time', b.kickoff_time, 'slot_minutes', b.slot_minutes,
    'series_id', b.series_id, 'amount_pence', b.amount_pence, 'payment_status', b.payment_status,
    'venue_id', b.venue_id, 'venue_name', v.name, 'venue_slug', v.slug, 'venue_city', v.city,
    'cancellation_policy', v.cancellation_policy, 'playing_area_id', b.playing_area_id, 'pitch_name', pa.name
  ) ORDER BY b.booking_date, b.kickoff_time), '[]'::jsonb)
  INTO v_result
  FROM pitch_bookings b
  JOIN venues v ON v.id = b.venue_id
  JOIN playing_areas pa ON pa.id = b.playing_area_id
  WHERE b.team_id = p_team_id AND b.booking_date >= current_date - 30;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_team_bookings(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_bookings(text) TO authenticated;
