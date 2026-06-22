-- Down migration 400 — drop the operator toggle RPCs + the settings read, and
-- restore get_venue_feature_flags to the mig-399 body (no `disciplines` key).

DROP FUNCTION IF EXISTS public.venue_get_feature_settings(text);
DROP FUNCTION IF EXISTS public.venue_set_venue_feature(text, text, boolean);
DROP FUNCTION IF EXISTS public.venue_set_club_feature(text, text, text, boolean);

-- Restore the mig-399 reader (without disciplines).
CREATE OR REPLACE FUNCTION public.get_venue_feature_flags(p_credential text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_vf       record;
  v_cf       record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  v_venue_id := v_caller.venue_id;

  IF v_venue_id IS NULL THEN
    RETURN jsonb_build_object(
      'bookings', true, 'spaces', true, 'room_hire', true, 'equipment', true,
      'memberships', true, 'competition', true, 'coaching', true,
      'tournaments', true, 'public_web', true
    );
  END IF;

  SELECT COALESCE(vf.bookings,  true) AS bookings,
         COALESCE(vf.spaces,    true) AS spaces,
         COALESCE(vf.room_hire, true) AS room_hire,
         COALESCE(vf.equipment, true) AS equipment
    INTO v_vf
  FROM (SELECT v_venue_id AS venue_id) base
  LEFT JOIN public.venue_features vf ON vf.venue_id = base.venue_id;

  SELECT COALESCE(bool_or(COALESCE(cf.memberships, true)), true) AS memberships,
         COALESCE(bool_or(COALESCE(cf.competition, true)), true) AS competition,
         COALESCE(bool_or(COALESCE(cf.coaching,    true)), true) AS coaching,
         COALESCE(bool_or(COALESCE(cf.tournaments, true)), true) AS tournaments,
         COALESCE(bool_or(COALESCE(cf.public_web,  true)), true) AS public_web
    INTO v_cf
  FROM public.club_venues cv
  LEFT JOIN public.club_features cf ON cf.club_id = cv.club_id
  WHERE cv.venue_id = v_venue_id;

  RETURN jsonb_build_object(
    'bookings',    v_vf.bookings,
    'spaces',      v_vf.spaces,
    'room_hire',   v_vf.room_hire,
    'equipment',   v_vf.equipment,
    'memberships', COALESCE(v_cf.memberships, true),
    'competition', COALESCE(v_cf.competition, true),
    'coaching',    COALESCE(v_cf.coaching,    true),
    'tournaments', COALESCE(v_cf.tournaments, true),
    'public_web',  COALESCE(v_cf.public_web,  true)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_venue_feature_flags(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_venue_feature_flags(text) TO anon, authenticated;
