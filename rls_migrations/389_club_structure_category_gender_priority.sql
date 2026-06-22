-- 389 — Club Org & Team Structure, Phase 1 (venue console)
-- Epic: CLUB_STRUCTURE_HANDOFF.md. Additive only — no renames/drops of columns.
-- Adds: club_cohorts.category, club_teams.gender/priority_rank/archived_at.
-- Extends club_create_cohort / club_update_cohort with p_category.
-- New venue-token RPCs: club_create_team / club_update_team / club_list_teams /
-- club_archive_team. All follow the established venue-token pattern:
--   resolve_venue_caller(p_venue_token) -> _venue_has_cap(..., 'manage_memberships')
--   on writes, + audit_events insert (Hard Rule #9). anon+authenticated grant
--   (the venue token is the auth signal, same as every other club_* RPC).
-- Backfill: demo cohorts/teams given sensible category/gender/rank (idempotent).

-- ── 1. Columns (additive) ────────────────────────────────────────────────────
ALTER TABLE public.club_cohorts
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IS NULL OR category IN ('youth','adult','mixed'));

ALTER TABLE public.club_teams
  ADD COLUMN IF NOT EXISTS gender text
    CHECK (gender IS NULL OR gender IN ('girls','boys','mixed')),
  ADD COLUMN IF NOT EXISTS priority_rank int,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ── 2. Extend cohort RPCs with p_category ────────────────────────────────────
-- Adding a param changes the signature; CREATE OR REPLACE would leave the old
-- arity as a separate overload -> "could not choose best candidate". DROP first.
DROP FUNCTION IF EXISTS public.club_create_cohort(text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.club_update_cohort(text, uuid, text, text, integer, integer, boolean);

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
  -- cohort must belong to a club linked to this venue
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

-- ── 3. New team RPCs ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_create_team(
  p_venue_token text, p_club_id text, p_cohort_id uuid, p_name text,
  p_gender text DEFAULT NULL, p_priority_rank integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_team_id  uuid;
  v_name     text := NULLIF(btrim(p_name), '');
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
  IF p_gender IS NOT NULL AND p_gender NOT IN ('girls','boys','mixed') THEN
    RAISE EXCEPTION 'invalid_gender' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- cohort must belong to the same club
  IF NOT EXISTS (SELECT 1 FROM public.club_cohorts WHERE id = p_cohort_id AND club_id = p_club_id) THEN
    RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_teams (club_id, cohort_id, name, gender, priority_rank)
  VALUES (p_club_id, p_cohort_id, v_name, p_gender, p_priority_rank)
  RETURNING id INTO v_team_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_team_created', 'club_team', v_team_id::text,
          jsonb_build_object('club_id', p_club_id, 'cohort_id', p_cohort_id, 'name', v_name, 'gender', p_gender));
  RETURN jsonb_build_object('ok', true, 'team_id', v_team_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_update_team(
  p_venue_token text, p_team_id uuid, p_name text DEFAULT NULL,
  p_gender text DEFAULT NULL, p_priority_rank integer DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL)
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
  IF p_gender IS NOT NULL AND p_gender NOT IN ('girls','boys','mixed') THEN
    RAISE EXCEPTION 'invalid_gender' USING ERRCODE = 'P0001';
  END IF;
  -- team must belong to a club linked to this venue
  SELECT ct.club_id INTO v_club_id
  FROM public.club_teams ct
  JOIN public.club_venues cv ON cv.club_id = ct.club_id AND cv.venue_id = v_venue_id
  WHERE ct.id = p_team_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;
  -- if re-homing the team, the new cohort must belong to the same club
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.club_cohorts WHERE id = p_cohort_id AND club_id = v_club_id) THEN
    RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.club_teams SET
    name          = COALESCE(NULLIF(btrim(p_name), ''), name),
    gender        = COALESCE(p_gender, gender),
    priority_rank = COALESCE(p_priority_rank, priority_rank),
    cohort_id     = COALESCE(p_cohort_id, cohort_id)
  WHERE id = p_team_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_team_updated', 'club_team', p_team_id::text,
          jsonb_build_object('club_id', v_club_id));
  RETURN jsonb_build_object('ok', true, 'team_id', p_team_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_archive_team(
  p_venue_token text, p_team_id uuid)
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
  SELECT ct.club_id INTO v_club_id
  FROM public.club_teams ct
  JOIN public.club_venues cv ON cv.club_id = ct.club_id AND cv.venue_id = v_venue_id
  WHERE ct.id = p_team_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.club_teams SET archived_at = now() WHERE id = p_team_id AND archived_at IS NULL;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_team_archived', 'club_team', p_team_id::text,
          jsonb_build_object('club_id', v_club_id));
  RETURN jsonb_build_object('ok', true, 'team_id', p_team_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_list_teams(
  p_venue_token text, p_club_id text, p_include_archived boolean DEFAULT false)
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
        'team_id',       ct.id,
        'cohort_id',     ct.cohort_id,
        'cohort_name',   cc.name,
        'cohort_category', cc.category,
        'name',          ct.name,
        'gender',        ct.gender,
        'priority_rank', ct.priority_rank,
        'archived_at',   ct.archived_at,
        'member_count',  (SELECT count(*) FROM public.club_team_members m
                            WHERE m.team_id = ct.id AND COALESCE(m.is_active, true)),
        'created_at',    ct.created_at
      )
      ORDER BY cc.name, ct.priority_rank NULLS LAST, ct.name
    ), '[]'::jsonb)
    FROM public.club_teams ct
    JOIN public.club_cohorts cc ON cc.id = ct.cohort_id
    WHERE ct.club_id = p_club_id
      AND (p_include_archived OR ct.archived_at IS NULL)
  );
END;
$function$;

-- ── 4. Extend club_list_cohorts return with category ─────────────────────────
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

-- ── 5. Grants (venue-token pattern: anon + authenticated) ────────────────────
REVOKE ALL ON FUNCTION public.club_create_cohort(text, text, text, text, integer, integer, text) FROM public;
REVOKE ALL ON FUNCTION public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text) FROM public;
REVOKE ALL ON FUNCTION public.club_create_team(text, text, uuid, text, text, integer) FROM public;
REVOKE ALL ON FUNCTION public.club_update_team(text, uuid, text, text, integer, uuid) FROM public;
REVOKE ALL ON FUNCTION public.club_archive_team(text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.club_list_teams(text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.club_create_cohort(text, text, text, text, integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_create_team(text, text, uuid, text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_update_team(text, uuid, text, text, integer, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_archive_team(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_list_teams(text, text, boolean) TO anon, authenticated;

-- ── 6. Demo backfill (idempotent) ────────────────────────────────────────────
UPDATE public.club_cohorts SET category = 'adult'
  WHERE category IS NULL AND lower(name) LIKE '%adult%';
UPDATE public.club_cohorts SET category = 'youth'
  WHERE category IS NULL AND (lower(name) LIKE '%junior%' OR name ~* '^u\d+');
-- demo teams: both club_demo teams default to mixed + top rank
UPDATE public.club_teams SET gender = 'mixed' WHERE gender IS NULL AND club_id = 'club_demo';
UPDATE public.club_teams SET priority_rank = 1 WHERE priority_rank IS NULL AND club_id = 'club_demo';
