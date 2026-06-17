-- Down migration 356 — revert Gym/Boxing Phase 1 sparring flag.
-- Restores every touched function to its mig-355-era body and drops the column.
-- Reverse order of the up migration.

-- 6. get_member_pass — restore (drop discipline + clubs join).
CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_m      record;
  v_offers jsonb;
  v        jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT m.id, m.venue_id, m.club_id, m.tier_id, m.member_profile_id
    INTO v_m
    FROM public.venue_memberships m
   WHERE m.pass_token = p_token AND m.status <> 'cancelled';
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_id',     o.id,
      'partner_name', pn.name,
      'title',        o.title,
      'description',  o.description,
      'code',         o.code
    ) ORDER BY o.created_at), '[]'::jsonb)
    INTO v_offers
    FROM public.partner_offers o
    JOIN public.venue_partners pn ON pn.id = o.partner_id
   WHERE o.venue_id = v_m.venue_id AND o.active AND pn.active
     AND (o.tier_ids IS NULL OR array_length(o.tier_ids,1) IS NULL OR v_m.tier_id = ANY(o.tier_ids));

  SELECT jsonb_build_object(
    'ok',               true,
    'member_profile_id', m.member_profile_id,
    'club_id',          m.club_id,
    'first_name',       COALESCE(c.first_name, mp.first_name),
    'last_name',        COALESCE(c.last_name,  mp.last_name),
    'tier_name',        t.name,
    'benefits',         t.benefits,
    'period',           m.period,
    'amount_pence',     m.amount_pence,
    'status',           m.status,
    'payment_state',    m.payment_state,
    'started_at',       m.started_at,
    'renews_at',        m.renews_at,
    'frozen_until',     m.frozen_until,
    'venue_name',       vn.name,
    'venue_logo',       vn.logo_url,
    'primary_colour',   vn.primary_colour,
    'secondary_colour', vn.secondary_colour,
    'check_in_code',    m.pass_token,
    'offers',           v_offers,
    'valid_venues',     COALESCE(
      CASE WHEN m.club_id IS NOT NULL THEN
        (SELECT jsonb_agg(jsonb_build_object('venue_id', v2.id, 'venue_name', v2.name)
                          ORDER BY v2.name)
           FROM public.club_venues cv2
           JOIN public.venues v2 ON v2.id = cv2.venue_id
          WHERE cv2.club_id = m.club_id)
      END,
      jsonb_build_array(jsonb_build_object('venue_id', vn.id, 'venue_name', vn.name))
    )
  ) INTO v
  FROM public.venue_memberships m
  LEFT JOIN public.venue_customers c    ON c.id  = m.customer_id
  LEFT JOIN public.member_profiles mp   ON mp.id = m.member_profile_id
  JOIN  public.venue_membership_tiers t  ON t.id  = m.tier_id
  JOIN  public.venues vn                ON vn.id  = m.venue_id
  WHERE m.id = v_m.id;

  IF v IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN v;
END;
$function$;

-- 5. member_list_class_sessions — restore (drop ct.is_sparring).
CREATE OR REPLACE FUNCTION public.member_list_class_sessions(p_venue_id text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
           ct.description, ct.cancellation_cutoff_hours, ct.first_session_free,
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

-- 4. venue_list_class_types — restore (drop ct.is_sparring).
CREATE OR REPLACE FUNCTION public.venue_list_class_types(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
           ct.first_session_free, ct.is_active, ct.created_at,
           (SELECT count(*) FROM public.venue_class_sessions cs
             WHERE cs.class_type_id = ct.id AND cs.status = 'scheduled' AND cs.starts_at >= now())::int AS upcoming_session_count
    FROM public.venue_class_types ct
    JOIN public.venue_spaces sp ON sp.id = ct.space_id
    WHERE ct.venue_id = v_caller.venue_id
  ) x;
  RETURN v_result;
END;
$function$;

-- 3. venue_update_class_type — restore (drop is_sparring SET).
CREATE OR REPLACE FUNCTION public.venue_update_class_type(p_venue_token text, p_class_type_id uuid, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

-- 2. venue_create_class_type — drop the 10-arg, restore the 9-arg, re-grant.
DROP FUNCTION IF EXISTS public.venue_create_class_type(text, text, uuid, integer, integer, text, integer, boolean, text, boolean);

CREATE OR REPLACE FUNCTION public.venue_create_class_type(
  p_venue_token text, p_name text, p_space_id uuid, p_duration_minutes integer,
  p_default_capacity integer, p_category text, p_cancellation_cutoff_hours integer DEFAULT 2,
  p_first_session_free boolean DEFAULT false, p_description text DEFAULT NULL::text)
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
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  IF p_category NOT IN ('fitness','yoga','dance','martial_arts','other') THEN RAISE EXCEPTION 'bad_category' USING ERRCODE='P0001'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN RAISE EXCEPTION 'bad_duration' USING ERRCODE='P0001'; END IF;
  IF p_default_capacity IS NULL OR p_default_capacity < 0 THEN RAISE EXCEPTION 'bad_capacity' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_spaces WHERE id = p_space_id AND venue_id = v_caller.venue_id) THEN
    RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.venue_class_types
    (venue_id, space_id, name, description, category, duration_minutes,
     default_capacity, cancellation_cutoff_hours, first_session_free)
  VALUES
    (v_caller.venue_id, p_space_id, btrim(p_name), p_description, p_category, p_duration_minutes,
     p_default_capacity, COALESCE(p_cancellation_cutoff_hours, 2), COALESCE(p_first_session_free, false))
  RETURNING id INTO v_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_type_created', 'venue_class_type', v_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'name', btrim(p_name), 'category', p_category));
  RETURN jsonb_build_object('ok', true, 'class_type_id', v_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.venue_create_class_type(text, text, uuid, integer, integer, text, integer, boolean, text)
  TO anon, authenticated, service_role;

-- 1. Drop the column last (functions no longer reference it).
ALTER TABLE public.venue_class_types DROP COLUMN IF EXISTS is_sparring;
