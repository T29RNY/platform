-- 389 DOWN — revert Club Structure Phase 1.
-- Drops the four new team RPCs, the extended cohort-RPC overloads, and the
-- additive columns; restores the pre-389 cohort RPC signatures.

DROP FUNCTION IF EXISTS public.club_create_team(text, text, uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.club_update_team(text, uuid, text, text, integer, uuid);
DROP FUNCTION IF EXISTS public.club_archive_team(text, uuid);
DROP FUNCTION IF EXISTS public.club_list_teams(text, text, boolean);

DROP FUNCTION IF EXISTS public.club_create_cohort(text, text, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text);

-- restore pre-389 cohort signatures
CREATE OR REPLACE FUNCTION public.club_create_cohort(
  p_venue_token text, p_club_id text, p_name text,
  p_description text DEFAULT NULL, p_min_age integer DEFAULT NULL, p_max_age integer DEFAULT NULL)
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
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.club_cohorts (club_id, name, description, min_age, max_age)
  VALUES (p_club_id, v_name, p_description, p_min_age, p_max_age)
  RETURNING id INTO v_cohort_id;
  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_cohort_created', 'club_cohort', v_cohort_id::text,
          jsonb_build_object('club_id', p_club_id, 'name', v_name));
  RETURN jsonb_build_object('ok', true, 'cohort_id', v_cohort_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.club_create_cohort(text, text, text, text, integer, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.club_update_cohort(
  p_venue_token text, p_cohort_id uuid, p_name text DEFAULT NULL,
  p_description text DEFAULT NULL, p_min_age integer DEFAULT NULL,
  p_max_age integer DEFAULT NULL, p_active boolean DEFAULT NULL)
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
    active      = COALESCE(p_active, active)
  WHERE id = p_cohort_id;
  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_cohort_updated', 'club_cohort', p_cohort_id::text,
          jsonb_build_object('club_id', v_club_id));
  RETURN jsonb_build_object('ok', true, 'cohort_id', p_cohort_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.club_update_cohort(text, uuid, text, text, integer, integer, boolean) TO anon, authenticated;

-- restore pre-389 club_list_cohorts (no category field)
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
        'cohort_id',   cc.id, 'name', cc.name, 'description', cc.description,
        'min_age', cc.min_age, 'max_age', cc.max_age,
        'active', cc.active, 'created_at', cc.created_at
      ) ORDER BY cc.name
    ), '[]'::jsonb)
    FROM public.club_cohorts cc
    WHERE cc.club_id = p_club_id AND (p_include_inactive OR cc.active)
  );
END;
$function$;

ALTER TABLE public.club_teams   DROP COLUMN IF EXISTS gender, DROP COLUMN IF EXISTS priority_rank, DROP COLUMN IF EXISTS archived_at;
ALTER TABLE public.club_cohorts DROP COLUMN IF EXISTS category;
