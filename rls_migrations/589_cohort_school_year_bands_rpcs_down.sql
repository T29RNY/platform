-- 589_cohort_school_year_bands_rpcs_down.sql
-- Reverses 589: restores 389's cohort pair + club_list_cohorts and 399's
-- venue_update_class_type verbatim, so a school-year band becomes unwritable again.
--
-- ⚠️ ORDER: if 590 (P2c — DF's school-year data) has been applied, reverse THAT FIRST.
-- Rolling 589 back while cohorts/classes still carry school-year bands leaves rows that
-- no RPC can edit or clear, and club_list_cohorts stops returning the bands that 588's
-- resolver is still enforcing — i.e. an invisible, unfixable band. 588 itself stays put:
-- its columns and guard are independent of who can write them.

-- ── 1. Cohort pair: drop 589's arities, restore 389's ────────────────────────
DROP FUNCTION IF EXISTS public.club_create_cohort(text, text, text, text, integer, integer, text, integer, integer);
DROP FUNCTION IF EXISTS public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.club_create_cohort(
  p_venue_token text, p_club_id text, p_name text,
  p_description text DEFAULT NULL, p_min_age integer DEFAULT NULL,
  p_max_age integer DEFAULT NULL, p_category text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_cohort_id uuid;
  v_name      text := NULLIF(btrim(p_name), '');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001'; END IF;
  IF p_category IS NOT NULL AND p_category NOT IN ('youth','adult','mixed') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_cohorts (club_id, name, description, min_age, max_age, category)
  VALUES (p_club_id, v_name, p_description, p_min_age, p_max_age, p_category)
  RETURNING id INTO v_cohort_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_cohort_created', 'club_cohort', v_cohort_id::text,
          jsonb_build_object('club_id', p_club_id, 'name', v_name, 'category', p_category));
  RETURN jsonb_build_object('ok', true, 'cohort_id', v_cohort_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_update_cohort(
  p_venue_token text, p_cohort_id uuid, p_name text DEFAULT NULL,
  p_description text DEFAULT NULL, p_min_age integer DEFAULT NULL,
  p_max_age integer DEFAULT NULL, p_active boolean DEFAULT NULL,
  p_category text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club_id  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_category IS NOT NULL AND p_category NOT IN ('youth','adult','mixed') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'P0001';
  END IF;
  SELECT cc.club_id INTO v_club_id
  FROM public.club_cohorts cc
  JOIN public.club_venues cv ON cv.club_id = cc.club_id AND cv.venue_id = v_venue_id
  WHERE cc.id = p_cohort_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.club_cohorts SET
    name        = COALESCE(NULLIF(btrim(p_name), ''), name),
    description = COALESCE(p_description, description),
    min_age     = COALESCE(p_min_age, min_age),
    max_age     = COALESCE(p_max_age, max_age),
    active      = COALESCE(p_active, active),
    category    = COALESCE(p_category, category)
  WHERE id = p_cohort_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_cohort_updated', 'club_cohort', p_cohort_id::text,
          jsonb_build_object('club_id', v_club_id));
  RETURN jsonb_build_object('ok', true, 'cohort_id', p_cohort_id);
END;
$function$;

-- ── 2. Restore 389's club_list_cohorts (no school-year keys) ─────────────────
CREATE OR REPLACE FUNCTION public.club_list_cohorts(
  p_venue_token text, p_club_id text, p_include_inactive boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'cohort_id',   cc.id,
        'name',        cc.name,
        'description', cc.description,
        'category',    cc.category,
        'min_age',     cc.min_age,
        'max_age',     cc.max_age,
        'active',      cc.active,
        'created_at',  cc.created_at
      ) ORDER BY cc.name
    ), '[]'::jsonb)
    FROM public.club_cohorts cc
    WHERE cc.club_id = p_club_id
      AND (p_include_inactive OR cc.active)
  );
END;
$function$;

-- ── 3. Restore 399's venue_update_class_type (no band columns) ───────────────
CREATE OR REPLACE FUNCTION public.venue_update_class_type(
  p_venue_token text, p_class_type_id uuid, p_updates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_ct public.venue_class_types;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
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
    members_only              = COALESCE((p_updates->>'members_only')::boolean, members_only),
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

-- ── 4. Restore 389's grants on the reverted cohort signatures ────────────────
REVOKE ALL ON FUNCTION public.club_create_cohort(text, text, text, text, integer, integer, text) FROM public;
REVOKE ALL ON FUNCTION public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.club_create_cohort(text, text, text, text, integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text) TO anon, authenticated;
