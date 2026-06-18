-- ── 360 DOWN: revert Classes open / free / trial access ──────────────────────
-- Restores the pre-360 function bodies (no members_only) and drops the column.

-- 1. member_book_class_session — restore the unconditional membership gate.
CREATE OR REPLACE FUNCTION public.member_book_class_session(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   public.member_profiles;
  v_sess      public.venue_class_sessions;
  v_threshold int;
  v_occupied  int;
  v_existing  public.venue_class_bookings;
  v_status    text;
  v_wpos      int;
  v_booking_id uuid;
  v_connected boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RAISE EXCEPTION 'session_not_bookable' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.venue_memberships
                  WHERE member_profile_id = v_profile.id AND venue_id = v_sess.venue_id
                    AND status IN ('active','ending')) THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE='P0001';
  END IF;

  SELECT no_show_suspension_threshold INTO v_threshold FROM public.venues WHERE id = v_sess.venue_id;
  IF v_threshold IS NOT NULL AND v_profile.no_show_count >= v_threshold THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suspended', 'no_show_count', v_profile.no_show_count);
  END IF;

  IF v_sess.payment_mode = 'prepay' THEN
    SELECT EXISTS (SELECT 1 FROM public.venue_integrations
                    WHERE venue_id = v_sess.venue_id AND provider = 'stripe' AND status = 'connected')
      INTO v_connected;
    IF NOT v_connected THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'payment_method_unavailable');
    END IF;
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_profile.id;
  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed','waitlist','offered') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_booked',
                              'booking_id', v_existing.id, 'status', v_existing.status);
  END IF;

  SELECT count(*) INTO v_occupied FROM public.venue_class_bookings
   WHERE session_id = p_session_id
     AND (status = 'confirmed'
          OR (status = 'offered' AND offer_expires_at > now()));
  IF v_sess.capacity > 0 AND v_occupied < v_sess.capacity THEN
    v_status := 'confirmed'; v_wpos := NULL;
  ELSE
    v_status := 'waitlist';
    SELECT COALESCE(max(waitlist_position), 0) + 1 INTO v_wpos
      FROM public.venue_class_bookings WHERE session_id = p_session_id AND status = 'waitlist';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.venue_class_bookings
       SET status = v_status, waitlist_position = v_wpos, booked_at = now(),
           cancelled_at = NULL, offer_expires_at = NULL,
           payment_status = 'pending', payment_method = 'not_yet'
     WHERE id = v_existing.id
     RETURNING id INTO v_booking_id;
  ELSE
    INSERT INTO public.venue_class_bookings (session_id, member_profile_id, status, waitlist_position)
    VALUES (p_session_id, v_profile.id, v_status, v_wpos)
    RETURNING id INTO v_booking_id;
  END IF;

  IF v_status = 'confirmed' THEN
    PERFORM public._apply_class_booking_charge(v_booking_id);
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings WHERE id = v_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_sess.venue_id, v_uid, 'player', 'member_class_booked', 'venue_class_booking', v_booking_id::text,
          jsonb_build_object('session_id', p_session_id, 'status', v_status,
                             'member_profile_id', v_profile.id, 'waitlist_position', v_wpos));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', v_status,
                            'payment_status', v_existing.payment_status,
                            'payment_method', v_existing.payment_method,
                            'waitlist_position', v_wpos);
END;
$function$;

-- 2. member_list_class_sessions — drop members_only from the return shape.
CREATE OR REPLACE FUNCTION public.member_list_class_sessions(p_venue_id text, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_from       timestamptz;
  v_to         timestamptz;
  v_result     jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  END IF;
  v_from := COALESCE(p_from, now());
  v_to   := COALESCE(p_to, now() + INTERVAL '28 days');

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.starts_at), '[]'::jsonb) INTO v_result FROM (
    SELECT cs.id AS session_id, cs.venue_id, cs.class_type_id, ct.name AS class_name, ct.category,
           ct.description, ct.cancellation_cutoff_hours, ct.first_session_free, ct.is_sparring,
           cs.space_id, sp.name AS space_name, cs.instructor_id, va.email AS instructor_email,
           cs.starts_at, cs.ends_at, cs.capacity, cs.price_pence, cs.payment_mode,
           (SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.status = 'confirmed')::int AS booked_count,
           (SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.status = 'waitlist')::int  AS waitlist_count,
           GREATEST(cs.capacity - (SELECT count(*) FROM public.venue_class_bookings b
                                    WHERE b.session_id = cs.id
                                      AND (b.status = 'confirmed'
                                           OR (b.status = 'offered' AND b.offer_expires_at > now()))), 0)::int AS spots_left,
           (SELECT b.status            FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_status,
           (SELECT b.id                FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_booking_id,
           (SELECT b.waitlist_position FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_waitlist_position,
           (SELECT b.offer_expires_at  FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.member_profile_id = v_profile_id) AS my_offer_expires_at
    FROM public.venue_class_sessions cs
    JOIN public.venue_class_types ct ON ct.id = cs.class_type_id
    JOIN public.venue_spaces sp ON sp.id = cs.space_id
    LEFT JOIN public.venue_admins va ON va.id = cs.instructor_id
    WHERE cs.venue_id = p_venue_id
      AND cs.status = 'scheduled'
      AND cs.starts_at >= v_from
      AND cs.starts_at <= v_to
  ) x;
  RETURN v_result;
END;
$function$;

-- 3. venue_list_class_types — drop members_only from the return shape.
CREATE OR REPLACE FUNCTION public.venue_list_class_types(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_caller record; v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.is_active DESC, x.name), '[]'::jsonb) INTO v_result FROM (
    SELECT ct.id, ct.venue_id, ct.space_id, sp.name AS space_name, ct.name, ct.description,
           ct.category, ct.duration_minutes, ct.default_capacity, ct.cancellation_cutoff_hours,
           ct.first_session_free, ct.is_sparring, ct.is_active, ct.created_at,
           (SELECT count(*) FROM public.venue_class_sessions cs
             WHERE cs.class_type_id = ct.id AND cs.status = 'scheduled' AND cs.starts_at >= now())::int AS upcoming_session_count
    FROM public.venue_class_types ct
    JOIN public.venue_spaces sp ON sp.id = ct.space_id
    WHERE ct.venue_id = v_caller.venue_id
  ) x;
  RETURN v_result;
END;
$function$;

-- 4. venue_update_class_type — drop the members_only patch line.
CREATE OR REPLACE FUNCTION public.venue_update_class_type(p_venue_token text, p_class_type_id uuid, p_updates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_caller record; v_ct public.venue_class_types;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ct FROM public.venue_class_types WHERE id = p_class_type_id;
  IF NOT FOUND OR v_ct.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'class_type_not_found' USING ERRCODE='P0001';
  END IF;
  IF p_updates ? 'category' AND (p_updates->>'category') NOT IN ('fitness','yoga','dance','martial_arts','other') THEN
    RAISE EXCEPTION 'bad_category' USING ERRCODE='P0001'; END IF;
  IF p_updates ? 'duration_minutes' AND (p_updates->>'duration_minutes')::int <= 0 THEN
    RAISE EXCEPTION 'bad_duration' USING ERRCODE='P0001'; END IF;
  IF p_updates ? 'default_capacity' AND (p_updates->>'default_capacity')::int < 0 THEN
    RAISE EXCEPTION 'bad_capacity' USING ERRCODE='P0001'; END IF;
  IF p_updates ? 'space_id' AND NOT EXISTS (
    SELECT 1 FROM public.venue_spaces WHERE id = (p_updates->>'space_id')::uuid AND venue_id = v_caller.venue_id) THEN
    RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001'; END IF;
  UPDATE public.venue_class_types SET
    name                      = COALESCE(NULLIF(btrim(p_updates->>'name'), ''), name),
    description               = CASE WHEN p_updates ? 'description' THEN p_updates->>'description' ELSE description END,
    category                  = COALESCE(p_updates->>'category', category),
    duration_minutes          = COALESCE((p_updates->>'duration_minutes')::int, duration_minutes),
    default_capacity          = COALESCE((p_updates->>'default_capacity')::int, default_capacity),
    cancellation_cutoff_hours = COALESCE((p_updates->>'cancellation_cutoff_hours')::int, cancellation_cutoff_hours),
    first_session_free        = COALESCE((p_updates->>'first_session_free')::boolean, first_session_free),
    is_sparring               = COALESCE((p_updates->>'is_sparring')::boolean, is_sparring),
    space_id                  = COALESCE((p_updates->>'space_id')::uuid, space_id),
    is_active                 = COALESCE((p_updates->>'is_active')::boolean, is_active)
  WHERE id = p_class_type_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_type_updated', 'venue_class_type', p_class_type_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'updates', p_updates));
  RETURN jsonb_build_object('ok', true, 'class_type_id', p_class_type_id);
END;
$function$;

-- 5. venue_create_class_type — drop the 11-arg overload, restore the 10-arg.
DROP FUNCTION IF EXISTS public.venue_create_class_type(text,text,uuid,integer,integer,text,integer,boolean,text,boolean,boolean);

CREATE OR REPLACE FUNCTION public.venue_create_class_type(
  p_venue_token text, p_name text, p_space_id uuid, p_duration_minutes integer,
  p_default_capacity integer, p_category text,
  p_cancellation_cutoff_hours integer DEFAULT 2, p_first_session_free boolean DEFAULT false,
  p_description text DEFAULT NULL::text, p_is_sparring boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_caller record; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
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
     default_capacity, cancellation_cutoff_hours, first_session_free, is_sparring)
  VALUES
    (v_caller.venue_id, p_space_id, btrim(p_name), p_description, p_category, p_duration_minutes,
     p_default_capacity, COALESCE(p_cancellation_cutoff_hours, 2), COALESCE(p_first_session_free, false),
     COALESCE(p_is_sparring, false))
  RETURNING id INTO v_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_type_created', 'venue_class_type', v_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'name', btrim(p_name), 'category', p_category,
                             'is_sparring', COALESCE(p_is_sparring, false)));
  RETURN jsonb_build_object('ok', true, 'class_type_id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_create_class_type(text,text,uuid,integer,integer,text,integer,boolean,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_create_class_type(text,text,uuid,integer,integer,text,integer,boolean,text,boolean) TO anon, authenticated;

-- 6. Drop the column.
ALTER TABLE public.venue_class_types DROP COLUMN IF EXISTS members_only;
