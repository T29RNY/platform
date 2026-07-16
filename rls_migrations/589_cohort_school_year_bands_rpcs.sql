-- 589_cohort_school_year_bands_rpcs.sql
-- P2b of the DF Sports trial epic — make mig 588's school-year bands reachable.
--
-- 588 added club_cohorts.school_year_min/max, venue_class_types.school_year_min/max +
-- min_age/max_age, and the resolver/guard that READ them (_cohort_for_dob,
-- _class_age_eligibility). But no RPC ever WROTE them and club_list_cohorts never
-- returned them — so a school-year band was settable only by raw SQL, and invisible to
-- every client. This migration closes that gap. It writes no data itself.
--
-- BEHAVIOUR-PRESERVING AT THE RPC LAYER, but NOT strictly "dark" — an adversarial review
-- refuted that, and the honest version is worth writing down:
--   · Verified live 2026-07-16: 0 cohorts and 0 class types carry a school-year band, and
--     0 rows violate the new validation, so no existing row changes or breaks.
--   · Every new param defaults NULL and every new jsonb key is optional, so the OLD
--     deployed JS keeps working against these NEW bodies — which is why 589 can (and
--     must) be applied BEFORE its PR merges. The reverse is NOT true: the new wrappers
--     always send p_school_year_min/max, which the old 7/8-arg functions reject, so
--     merging first would 404 cohort create/edit AND the existing Season rollover.
--   · Two deliberate visible changes ride along: `bad_age_band` now rejects a min>max
--     band the UI previously saved as nonsense, and the venue cohort chip re-words
--     ("16–? yrs" → "Ages 16+") because both apps now share one band label.
-- DF's actual data lands separately (P2c / mig 590).
--
-- ⚠️ LIVE DEFINERS ARE 389 AND 399 — NOT 298/339.
-- The epic manifest pointed at 298:157 (cohort pair) and 339 (venue_update_class_type);
-- both were superseded, so patching them would have been a silent no-op — the same trap
-- 588 hit with 340 -> 399. The bodies below were pulled from 389/399 and cross-checked
-- against pg_get_functiondef on the live DB (exactly one overload of each exists).
--
-- INVARIANT INTRODUCED HERE: a cohort or class type is grouped by SCHOOL YEAR or by AGE,
-- never both. 588's resolver already makes a school-year band win outright, so a row
-- carrying both bands is data that silently lies to the operator — the age half is dead
-- but still rendered. These RPCs make that state unrepresentable (band_conflict) rather
-- than relying on each UI to police it.
--
-- WHY p_grouping EXISTS: 389's club_update_cohort is all-COALESCE, so a band can be set
-- but never CLEARED back to NULL. Switching a cohort from ages to school years REQUIRES
-- clearing. p_grouping ('school_year' | 'age') names the operator's intent explicitly and
-- clears the other pair. Omitted (NULL) => 389's exact COALESCE behaviour, so the two
-- SeasonRolloverModal callers that pass only min/max age are untouched.

-- ── 1. Cohort pair: arity changes, so DROP the old signatures first ──────────
-- CREATE OR REPLACE would leave 389's arities as separate overloads ->
-- "could not choose best candidate function". Same idiom 389 itself used on 298's.
DROP FUNCTION IF EXISTS public.club_create_cohort(text, text, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text);

CREATE OR REPLACE FUNCTION public.club_create_cohort(
  p_venue_token text, p_club_id text, p_name text,
  p_description text DEFAULT NULL, p_min_age integer DEFAULT NULL,
  p_max_age integer DEFAULT NULL, p_category text DEFAULT NULL,
  p_school_year_min integer DEFAULT NULL, p_school_year_max integer DEFAULT NULL)
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

  -- Band invariant: school year XOR age, never both (see header).
  IF (p_min_age IS NOT NULL OR p_max_age IS NOT NULL)
     AND (p_school_year_min IS NOT NULL OR p_school_year_max IS NOT NULL) THEN
    RAISE EXCEPTION 'band_conflict' USING ERRCODE = 'P0001';
  END IF;
  IF p_school_year_min IS NOT NULL AND p_school_year_max IS NOT NULL
     AND p_school_year_min > p_school_year_max THEN
    RAISE EXCEPTION 'bad_year_band' USING ERRCODE = 'P0001';
  END IF;
  IF p_min_age IS NOT NULL AND p_max_age IS NOT NULL AND p_min_age > p_max_age THEN
    RAISE EXCEPTION 'bad_age_band' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_cohorts (club_id, name, description, min_age, max_age, category,
                                   school_year_min, school_year_max)
  VALUES (p_club_id, v_name, p_description, p_min_age, p_max_age, p_category,
          p_school_year_min, p_school_year_max)
  RETURNING id INTO v_cohort_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_cohort_created', 'club_cohort', v_cohort_id::text,
          jsonb_build_object('club_id', p_club_id, 'name', v_name, 'category', p_category,
                             'school_year_min', p_school_year_min,
                             'school_year_max', p_school_year_max));
  RETURN jsonb_build_object('ok', true, 'cohort_id', v_cohort_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.club_update_cohort(
  p_venue_token text, p_cohort_id uuid, p_name text DEFAULT NULL,
  p_description text DEFAULT NULL, p_min_age integer DEFAULT NULL,
  p_max_age integer DEFAULT NULL, p_active boolean DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_school_year_min integer DEFAULT NULL, p_school_year_max integer DEFAULT NULL,
  p_grouping text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club_id  text;
  v_cur      public.club_cohorts;
  v_min_age  integer;
  v_max_age  integer;
  v_sy_min   integer;
  v_sy_max   integer;
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
  IF p_grouping IS NOT NULL AND p_grouping NOT IN ('school_year','age') THEN
    RAISE EXCEPTION 'invalid_grouping' USING ERRCODE = 'P0001';
  END IF;

  -- cohort must belong to a club linked to this venue
  SELECT cc.club_id INTO v_club_id
  FROM public.club_cohorts cc
  JOIN public.club_venues cv ON cv.club_id = cc.club_id AND cv.venue_id = v_venue_id
  WHERE cc.id = p_cohort_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_cur FROM public.club_cohorts WHERE id = p_cohort_id;

  -- Resolve the target band. p_grouping names the operator's intent and clears the other
  -- pair; omitting it keeps 389's COALESCE semantics verbatim for legacy callers.
  IF p_grouping = 'age' THEN
    v_min_age := p_min_age; v_max_age := p_max_age;
    v_sy_min  := NULL;      v_sy_max  := NULL;
  ELSIF p_grouping = 'school_year' THEN
    v_sy_min  := p_school_year_min; v_sy_max := p_school_year_max;
    v_min_age := NULL;              v_max_age := NULL;
  ELSE
    v_min_age := COALESCE(p_min_age, v_cur.min_age);
    v_max_age := COALESCE(p_max_age, v_cur.max_age);
    v_sy_min  := COALESCE(p_school_year_min, v_cur.school_year_min);
    v_sy_max  := COALESCE(p_school_year_max, v_cur.school_year_max);
  END IF;

  IF (v_min_age IS NOT NULL OR v_max_age IS NOT NULL)
     AND (v_sy_min IS NOT NULL OR v_sy_max IS NOT NULL) THEN
    RAISE EXCEPTION 'band_conflict' USING ERRCODE = 'P0001';
  END IF;
  IF v_sy_min IS NOT NULL AND v_sy_max IS NOT NULL AND v_sy_min > v_sy_max THEN
    RAISE EXCEPTION 'bad_year_band' USING ERRCODE = 'P0001';
  END IF;
  IF v_min_age IS NOT NULL AND v_max_age IS NOT NULL AND v_min_age > v_max_age THEN
    RAISE EXCEPTION 'bad_age_band' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.club_cohorts SET
    name            = COALESCE(NULLIF(btrim(p_name), ''), name),
    description     = COALESCE(p_description, description),
    active          = COALESCE(p_active, active),
    category        = COALESCE(p_category, category),
    min_age         = v_min_age,
    max_age         = v_max_age,
    school_year_min = v_sy_min,
    school_year_max = v_sy_max
  WHERE id = p_cohort_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_cohort_updated', 'club_cohort', p_cohort_id::text,
          jsonb_build_object('club_id', v_club_id, 'grouping', p_grouping,
                             'school_year_min', v_sy_min, 'school_year_max', v_sy_max,
                             'min_age', v_min_age, 'max_age', v_max_age));
  RETURN jsonb_build_object('ok', true, 'cohort_id', p_cohort_id);
END;
$function$;

-- ── 2. club_list_cohorts must return the bands it can now set ────────────────
-- Hard Rule 12: this is a hand-built jsonb shape, not SELECT *. Without these two keys
-- the client can set a school-year band and then never read it back.
-- Signature unchanged -> no DROP, no grant change needed.
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
        'cohort_id',       cc.id,
        'name',            cc.name,
        'description',     cc.description,
        'category',        cc.category,
        'min_age',         cc.min_age,
        'max_age',         cc.max_age,
        'school_year_min', cc.school_year_min,
        'school_year_max', cc.school_year_max,
        'active',          cc.active,
        'created_at',      cc.created_at
      ) ORDER BY cc.name
    ), '[]'::jsonb)
    FROM public.club_cohorts cc
    WHERE cc.club_id = p_club_id
      AND (p_include_inactive OR cc.active)
  );
END;
$function$;

-- ── 3. venue_update_class_type: teach the whitelist the four band columns ────
-- 399's "whitelist" is a hardcoded SET list — a column absent from it is silently
-- ignored. Signature is (text, uuid, jsonb), so adding keys is NOT an arity change:
-- no DROP, no grant change, no JS wrapper change (it passes p_updates straight through).
--
-- Bands use the `?`-operator idiom (399's `description` precedent), NOT COALESCE, so an
-- operator can REMOVE a band. COALESCE would make a band permanent once set.
CREATE OR REPLACE FUNCTION public.venue_update_class_type(
  p_venue_token text, p_class_type_id uuid, p_updates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_ct     public.venue_class_types;
  v_sy_min integer;
  v_sy_max integer;
  v_min_age integer;
  v_max_age integer;
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

  -- A band write needs 'manage_memberships' — the SAME cap the cohort RPCs require.
  -- 399's venue_update_class_type has no cap gate at all (any staff role at the venue may
  -- rename/re-space/deactivate a class). That was tolerable while every field was purely
  -- operational, but these four columns are what _class_age_eligibility reads to refuse a
  -- booking: clearing them lets a parent book a 6-year-old into a U12 session. 589 is the
  -- migration that decides which gate the new write lands behind, so it must not pick the
  -- weaker one just because it's the one already there.
  -- Scoped to band keys ONLY, so every existing caller (name/capacity/space/active) is
  -- untouched — no class carries a band today, so nothing can break.
  IF (p_updates ?| array['school_year_min','school_year_max','min_age','max_age'])
     AND NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  -- Resolve the RESULTING band (patch key wins, else keep current), then validate it.
  -- Validating the result rather than the patch is what stops a partial patch from
  -- leaving a row in a state the invariant forbids.
  v_sy_min  := CASE WHEN p_updates ? 'school_year_min' THEN (p_updates->>'school_year_min')::int ELSE v_ct.school_year_min END;
  v_sy_max  := CASE WHEN p_updates ? 'school_year_max' THEN (p_updates->>'school_year_max')::int ELSE v_ct.school_year_max END;
  v_min_age := CASE WHEN p_updates ? 'min_age'         THEN (p_updates->>'min_age')::int         ELSE v_ct.min_age         END;
  v_max_age := CASE WHEN p_updates ? 'max_age'         THEN (p_updates->>'max_age')::int         ELSE v_ct.max_age         END;

  IF (v_min_age IS NOT NULL OR v_max_age IS NOT NULL)
     AND (v_sy_min IS NOT NULL OR v_sy_max IS NOT NULL) THEN
    RAISE EXCEPTION 'band_conflict' USING ERRCODE='P0001';
  END IF;
  IF v_sy_min IS NOT NULL AND v_sy_max IS NOT NULL AND v_sy_min > v_sy_max THEN
    RAISE EXCEPTION 'bad_year_band' USING ERRCODE='P0001';
  END IF;
  IF v_min_age IS NOT NULL AND v_max_age IS NOT NULL AND v_min_age > v_max_age THEN
    RAISE EXCEPTION 'bad_age_band' USING ERRCODE='P0001';
  END IF;

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
    is_active                 = COALESCE((p_updates->>'is_active')::boolean, is_active),
    school_year_min           = v_sy_min,
    school_year_max           = v_sy_max,
    min_age                   = v_min_age,
    max_age                   = v_max_age
  WHERE id = p_class_type_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_type_updated', 'venue_class_type', p_class_type_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'updates', p_updates));
  RETURN jsonb_build_object('ok', true, 'class_type_id', p_class_type_id);
END;
$function$;

-- ── 4. Grants (venue-token pattern: anon + authenticated, as 389/399) ────────
-- The venue token IS the auth for these RPCs (resolve_venue_caller), which is why anon
-- holds EXECUTE. Named-role REVOKE per feedback_default_privileges_revoke: default
-- privileges re-grant to anon/authenticated on a newly created function, so REVOKE FROM
-- public alone would not close the old signature — but the old signature is DROPped
-- above, so these grants define the whole ACL of the new one.
REVOKE ALL ON FUNCTION public.club_create_cohort(text, text, text, text, integer, integer, text, integer, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text, integer, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_create_cohort(text, text, text, text, integer, integer, text, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_update_cohort(text, uuid, text, text, integer, integer, boolean, text, integer, integer, text) TO anon, authenticated;

-- club_list_cohorts + venue_update_class_type kept their signatures, so their existing
-- grants (298:153 / 399) still apply and are re-asserted here for completeness.
REVOKE ALL ON FUNCTION public.club_list_cohorts(text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.club_list_cohorts(text, text, boolean) TO anon, authenticated;
