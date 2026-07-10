-- 535_holiday_camps_create_rpcs_down.sql — reverse of 535.
-- Drops venue_create_camp + the extended venue_create_class_type, and restores the
-- pre-535 (mig 360) 11-arg venue_create_class_type verbatim.

DROP FUNCTION IF EXISTS public.venue_create_camp(text, uuid, uuid, date, date, time without time zone, integer, text);
DROP FUNCTION IF EXISTS public.venue_create_class_type(text, text, uuid, integer, integer, text, integer, boolean, text, boolean, boolean, boolean, text, text, time without time zone, time without time zone, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.venue_create_class_type(
  p_venue_token text, p_name text, p_space_id uuid, p_duration_minutes integer, p_default_capacity integer,
  p_category text, p_cancellation_cutoff_hours integer DEFAULT 2, p_first_session_free boolean DEFAULT false,
  p_description text DEFAULT NULL::text, p_is_sparring boolean DEFAULT false, p_members_only boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  IF p_category NOT IN ('fitness','yoga','dance','martial_arts','other') THEN RAISE EXCEPTION 'bad_category' USING ERRCODE='P0001'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN RAISE EXCEPTION 'bad_duration' USING ERRCODE='P0001'; END IF;
  IF p_default_capacity IS NULL OR p_default_capacity < 0 THEN RAISE EXCEPTION 'bad_capacity' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_spaces WHERE id = p_space_id AND venue_id = v_caller.venue_id) THEN
    RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.venue_class_types
    (venue_id, space_id, name, description, category, duration_minutes,
     default_capacity, cancellation_cutoff_hours, first_session_free, is_sparring, members_only)
  VALUES
    (v_caller.venue_id, p_space_id, btrim(p_name), p_description, p_category, p_duration_minutes,
     p_default_capacity, COALESCE(p_cancellation_cutoff_hours, 2), COALESCE(p_first_session_free, false),
     COALESCE(p_is_sparring, false), COALESCE(p_members_only, true))
  RETURNING id INTO v_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_type_created', 'venue_class_type', v_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'name', btrim(p_name), 'category', p_category,
                             'is_sparring', COALESCE(p_is_sparring, false),
                             'members_only', COALESCE(p_members_only, true)));
  RETURN jsonb_build_object('ok', true, 'class_type_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_create_class_type(text, text, uuid, integer, integer, text, integer, boolean, text, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_create_class_type(text, text, uuid, integer, integer, text, integer, boolean, text, boolean, boolean) TO anon, authenticated, service_role;
