-- Migration 391 — Club org/team epic Phase 3: membership-gated club-team join.
-- Two new RPCs. Additive only — no column/table/constraint changes.
--   1. club_team_join_context(p_code)      anon+authenticated  STABLE SECDEF resolver
--   2. member_join_club_team(p_code, p_for_profile_id)  authenticated-only writer
-- club_team_members has no unique index on (team_id, member_profile_id); the writer
-- guards with NOT EXISTS / reactivate rather than ON CONFLICT (no DDL on existing data).

-- ---------------------------------------------------------------------------
-- 1. Resolver: scan context + (optional) signed-in membership/on-team status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_team_join_context(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link      invite_links%ROWTYPE;
  v_status    text;
  v_team      record;
  v_venue_id  text;
  v_landing   text;
  v_uid       uuid := auth.uid();
  v_self      uuid;
  v_self_obj  jsonb := NULL;
  v_children  jsonb := '[]'::jsonb;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found');
  END IF;

  SELECT * INTO v_link FROM public.invite_links WHERE code = btrim(p_code);
  IF NOT FOUND OR v_link.entity_type <> 'club_team' OR v_link.action <> 'join_club_team' THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found', 'code', p_code);
  END IF;

  v_status :=
    CASE
      WHEN NOT v_link.active                                                     THEN 'inactive'
      WHEN v_link.expires_at IS NOT NULL AND v_link.expires_at < now()           THEN 'expired'
      WHEN v_link.max_uses   IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN 'exhausted'
      ELSE 'ok'
    END;

  SELECT ct.id, ct.name AS team_name, ct.gender, ct.archived_at,
         cc.id AS cohort_id, cc.name AS cohort_name, cc.category AS cohort_category,
         cl.id AS club_id, cl.name AS club_name
    INTO v_team
    FROM public.club_teams ct
    JOIN public.club_cohorts cc ON cc.id = ct.cohort_id
    JOIN public.clubs cl        ON cl.id = ct.club_id
   WHERE ct.id = v_link.entity_id::uuid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found', 'code', p_code);
  END IF;
  IF v_team.archived_at IS NOT NULL THEN
    v_status := 'inactive';
  END IF;

  -- Resolve the club's venue (1:1 for the pilot; LIMIT 1 mirrors the existing pattern)
  -- and that venue's canonical public membership-signup (venue_landing) code.
  SELECT cv.venue_id INTO v_venue_id
    FROM public.club_venues cv WHERE cv.club_id = v_team.club_id
   ORDER BY cv.venue_id LIMIT 1;

  IF v_venue_id IS NOT NULL THEN
    SELECT code INTO v_landing
      FROM public.invite_links
     WHERE entity_type = 'venue' AND action = 'venue_landing'
       AND entity_id = v_venue_id AND active
     ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_status = 'ok' AND v_landing IS NULL THEN
    v_status := 'signup_not_configured';
  END IF;

  -- Signed-in context: self + accepted children membership / on-team status.
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_self FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
    IF v_self IS NOT NULL THEN
      v_self_obj := jsonb_build_object(
        'profile_id',     v_self,
        'has_membership', EXISTS (SELECT 1 FROM public.venue_memberships m
                                   WHERE m.member_profile_id = v_self AND m.venue_id = v_venue_id
                                     AND m.status IN ('active','ending')),
        'on_team',        EXISTS (SELECT 1 FROM public.club_team_members ctm
                                   WHERE ctm.team_id = v_team.id AND ctm.member_profile_id = v_self
                                     AND ctm.is_active)
      );

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'profile_id',     cp.id,
               'first_name',     cp.first_name,
               'last_name',      cp.last_name,
               'has_membership', EXISTS (SELECT 1 FROM public.venue_memberships m
                                          WHERE m.member_profile_id = cp.id AND m.venue_id = v_venue_id
                                            AND m.status IN ('active','ending')),
               'on_team',        EXISTS (SELECT 1 FROM public.club_team_members ctm
                                          WHERE ctm.team_id = v_team.id AND ctm.member_profile_id = cp.id
                                            AND ctm.is_active)
             ) ORDER BY cp.first_name), '[]'::jsonb)
        INTO v_children
        FROM public.member_guardians mg
        JOIN public.member_profiles cp ON cp.id = mg.child_profile_id
       WHERE mg.guardian_profile_id = v_self AND mg.invite_state = 'accepted';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',                 v_status = 'ok',
    'status',             v_status,
    'code',               v_link.code,
    'team',               jsonb_build_object('id', v_team.id, 'name', v_team.team_name, 'gender', v_team.gender),
    'cohort',             jsonb_build_object('name', v_team.cohort_name, 'category', v_team.cohort_category),
    'club',               jsonb_build_object('id', v_team.club_id, 'name', v_team.club_name),
    'venue_id',           v_venue_id,
    'venue_landing_code', v_landing,
    'signed_in',          (v_uid IS NOT NULL),
    'has_profile',        (v_self IS NOT NULL),
    'self',               v_self_obj,
    'children',           v_children
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.club_team_join_context(text) FROM public;
GRANT EXECUTE ON FUNCTION public.club_team_join_context(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Writer: membership-gated assignment of self/child onto a club team.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_join_club_team(p_code text, p_for_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_caller    uuid;
  v_link      invite_links%ROWTYPE;
  v_team      record;
  v_venue_id  text;
  v_target    uuid;
  v_for_child boolean := false;
  v_existing  record;
  v_already   boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;

  SELECT id INTO v_caller FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_link FROM public.invite_links WHERE code = btrim(p_code);
  IF NOT FOUND OR v_link.entity_type <> 'club_team' OR v_link.action <> 'join_club_team' THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE='P0001';
  END IF;
  IF NOT v_link.active
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at < now())
     OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses) THEN
    RAISE EXCEPTION 'invite_inactive' USING ERRCODE='P0001';
  END IF;

  SELECT ct.id, ct.name AS team_name, ct.club_id, ct.archived_at
    INTO v_team FROM public.club_teams ct WHERE ct.id = v_link.entity_id::uuid;
  IF NOT FOUND OR v_team.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'team_unavailable' USING ERRCODE='P0001';
  END IF;

  SELECT cv.venue_id INTO v_venue_id
    FROM public.club_venues cv WHERE cv.club_id = v_team.club_id
   ORDER BY cv.venue_id LIMIT 1;
  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'club_venue_not_found' USING ERRCODE='P0001'; END IF;

  -- Resolve target: self, or an accepted child of the caller.
  IF p_for_profile_id IS NULL OR p_for_profile_id = v_caller THEN
    v_target := v_caller;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
       WHERE child_profile_id = p_for_profile_id
         AND guardian_profile_id = v_caller
         AND invite_state = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_target := p_for_profile_id;
    v_for_child := true;
  END IF;

  -- MEMBERSHIP GATE: the target must hold a live membership at the team's venue.
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships m
     WHERE m.member_profile_id = v_target AND m.venue_id = v_venue_id
       AND m.status IN ('active','ending')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_membership',
                              'team_id', v_team.id, 'member_profile_id', v_target);
  END IF;

  -- Idempotent assignment (no unique index on the table → guard + reactivate).
  SELECT id, is_active INTO v_existing
    FROM public.club_team_members
   WHERE team_id = v_team.id AND member_profile_id = v_target
   LIMIT 1;

  IF FOUND THEN
    IF v_existing.is_active THEN
      v_already := true;
    ELSE
      UPDATE public.club_team_members
         SET is_active = true, assigned_at = now()
       WHERE id = v_existing.id;
    END IF;
  ELSE
    INSERT INTO public.club_team_members (team_id, member_profile_id, is_active)
    VALUES (v_team.id, v_target, true);
  END IF;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue_id, v_uid, 'player', v_caller::text,
    'club_team_member_joined', 'club_team', v_team.id::text,
    jsonb_build_object(
      'member_profile_id', v_target,
      'club_id',           v_team.club_id,
      'for_child',         v_for_child,
      'already_on_team',   v_already,
      'via',               'join_club_team',
      'code',              v_link.code
    )
  );

  RETURN jsonb_build_object(
    'ok',                true,
    'assigned',          true,
    'already_on_team',   v_already,
    'team_id',           v_team.id,
    'team_name',         v_team.team_name,
    'member_profile_id', v_target,
    'for_child',         v_for_child
  );
END;
$function$;

-- Supabase default privileges auto-grant EXECUTE to anon on creation; REVOKE FROM
-- public does NOT remove that explicit grant, so revoke anon by name (this is an
-- authenticated-only writer).
REVOKE ALL     ON FUNCTION public.member_join_club_team(text, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.member_join_club_team(text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.member_join_club_team(text, uuid) TO authenticated;
