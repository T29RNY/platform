-- 338_venue_spaces_foundation.sql
--
-- Classes Booking + Room Hire — Phase 1: Hireable Spaces foundation.
--
-- Introduces `venue_spaces`, the canonical bookable-facility entity, distinct
-- from `playing_areas` (pitches carry the wrong abstraction for studios/rooms/
-- halls). Also lands `_space_is_available`, the shared double-booking guard the
-- Phase 2 class-session and Phase 5 room-hire booking RPCs will both call —
-- built here, before either product, so neither phase has to recreate it.
--
-- Forward-safety: `venue_class_sessions` (Phase 2) and `venue_room_hires`
-- (Phase 5) do not exist yet. Both the helper and `venue_list_spaces` guard
-- their references with `to_regclass(...)` and dynamic SQL, so they create and
-- run cleanly now (no conflicts to find), and begin enforcing automatically
-- once those tables land — no signature or body change required in later phases.

-- ── 1. venue_spaces table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_spaces (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              text        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  description           text,
  capacity              int         NOT NULL,
  space_type            text        NOT NULL CHECK (space_type IN ('studio','room','hall','outdoor')),
  is_enquiry_only       boolean     NOT NULL DEFAULT false,
  enquiry_contact_name  text,
  enquiry_contact_email text,
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_spaces_venue_idx ON public.venue_spaces (venue_id);

-- Writes only through the SECURITY DEFINER RPCs below; reads only through
-- venue_list_spaces. No direct client access.
ALTER TABLE public.venue_spaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_spaces FROM PUBLIC, anon, authenticated;

-- ── 2. _space_is_available helper (internal, non-SECDEF, STABLE) ─────────────
-- Returns false if ANY non-cancelled class session OR room hire on the same
-- space overlaps [p_starts_at, p_ends_at). STABLE (it reads rows — not
-- IMMUTABLE). Called inside the SECURITY DEFINER booking RPCs of Phases 2 & 5,
-- which supply the table privileges; REVOKEd from clients so it can't be called
-- directly. Standard half-open overlap test: existing.start < new.end AND
-- existing.end > new.start.

CREATE OR REPLACE FUNCTION public._space_is_available(
  p_space_id  uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_conflicts int := 0;
  v_cnt       int;
BEGIN
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'bad_time_range' USING ERRCODE = 'P0001';
  END IF;

  -- Phase 2: class sessions on this space.
  IF to_regclass('public.venue_class_sessions') IS NOT NULL THEN
    EXECUTE
      'SELECT count(*) FROM public.venue_class_sessions
        WHERE space_id = $1 AND status <> ''cancelled''
          AND starts_at < $3 AND ends_at > $2'
      INTO v_cnt USING p_space_id, p_starts_at, p_ends_at;
    v_conflicts := v_conflicts + COALESCE(v_cnt, 0);
  END IF;

  -- Phase 5: room hires on this space.
  IF to_regclass('public.venue_room_hires') IS NOT NULL THEN
    EXECUTE
      'SELECT count(*) FROM public.venue_room_hires
        WHERE space_id = $1 AND status <> ''cancelled''
          AND starts_at < $3 AND ends_at > $2'
      INTO v_cnt USING p_space_id, p_starts_at, p_ends_at;
    v_conflicts := v_conflicts + COALESCE(v_cnt, 0);
  END IF;

  RETURN v_conflicts = 0;
END;
$fn$;

-- NOTE: Supabase grants EXECUTE on new public functions to anon/authenticated
-- via ALTER DEFAULT PRIVILEGES, so REVOKE FROM PUBLIC alone is insufficient for
-- an internal helper — revoke the roles explicitly. (Phase 2/5 booking RPCs call
-- this from inside their own SECURITY DEFINER context, which retains privilege.)
REVOKE ALL ON FUNCTION public._space_is_available(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 3. venue_create_space ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_create_space(
  p_venue_token          text,
  p_name                 text,
  p_capacity             int,
  p_space_type           text,
  p_description          text    DEFAULT NULL,
  p_is_enquiry_only      boolean DEFAULT false,
  p_enquiry_contact_name text    DEFAULT NULL,
  p_enquiry_contact_email text   DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_id     uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF p_space_type NOT IN ('studio','room','hall','outdoor') THEN
    RAISE EXCEPTION 'bad_space_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_capacity IS NULL OR p_capacity < 0 THEN
    RAISE EXCEPTION 'bad_capacity' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_spaces
    (venue_id, name, description, capacity, space_type,
     is_enquiry_only, enquiry_contact_name, enquiry_contact_email)
  VALUES
    (v_caller.venue_id, btrim(p_name), p_description, p_capacity, p_space_type,
     COALESCE(p_is_enquiry_only, false), p_enquiry_contact_name, p_enquiry_contact_email)
  RETURNING id INTO v_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES
    (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
     'venue_space_created', 'venue_space', v_id::text,
     jsonb_build_object('venue_id', v_caller.venue_id, 'name', btrim(p_name),
                        'space_type', p_space_type, 'capacity', p_capacity));

  RETURN jsonb_build_object('ok', true, 'space_id', v_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_create_space(text,text,int,text,text,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_space(text,text,int,text,text,boolean,text,text) TO anon, authenticated;

-- ── 4. venue_update_space ─────────────────────────────────────────────────────
-- Partial update via a jsonb patch. `?` presence test lets a caller set a
-- nullable text field back to NULL; COALESCE-on-cast leaves untouched fields
-- alone. Ownership enforced: space must belong to the caller's venue.

CREATE OR REPLACE FUNCTION public.venue_update_space(
  p_venue_token text,
  p_space_id    uuid,
  p_updates     jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_space  public.venue_spaces;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_space FROM public.venue_spaces WHERE id = p_space_id;
  IF NOT FOUND OR v_space.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'space_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_updates ? 'space_type'
     AND (p_updates->>'space_type') NOT IN ('studio','room','hall','outdoor') THEN
    RAISE EXCEPTION 'bad_space_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_updates ? 'capacity' AND (p_updates->>'capacity')::int < 0 THEN
    RAISE EXCEPTION 'bad_capacity' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venue_spaces SET
    name                  = COALESCE(NULLIF(btrim(p_updates->>'name'), ''), name),
    description           = CASE WHEN p_updates ? 'description'           THEN p_updates->>'description'           ELSE description END,
    capacity              = COALESCE((p_updates->>'capacity')::int, capacity),
    space_type            = COALESCE(p_updates->>'space_type', space_type),
    is_enquiry_only       = COALESCE((p_updates->>'is_enquiry_only')::boolean, is_enquiry_only),
    enquiry_contact_name  = CASE WHEN p_updates ? 'enquiry_contact_name'  THEN p_updates->>'enquiry_contact_name'  ELSE enquiry_contact_name END,
    enquiry_contact_email = CASE WHEN p_updates ? 'enquiry_contact_email' THEN p_updates->>'enquiry_contact_email' ELSE enquiry_contact_email END,
    is_active             = COALESCE((p_updates->>'is_active')::boolean, is_active)
  WHERE id = p_space_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES
    (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
     'venue_space_updated', 'venue_space', p_space_id::text,
     jsonb_build_object('venue_id', v_caller.venue_id, 'updates', p_updates));

  RETURN jsonb_build_object('ok', true, 'space_id', p_space_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_update_space(text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_space(text,uuid,jsonb) TO anon, authenticated;

-- ── 5. venue_list_spaces ──────────────────────────────────────────────────────
-- Returns a jsonb array of the caller's spaces with upcoming session/hire
-- counts. The count subqueries are emitted dynamically and only when the
-- backing table exists, so this RPC is correct in Phase 1 (counts = 0) and
-- self-upgrades the instant Phases 2/5 add their tables — no later edit needed.

CREATE OR REPLACE FUNCTION public.venue_list_spaces(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller       record;
  v_result       jsonb;
  v_has_sessions boolean := to_regclass('public.venue_class_sessions') IS NOT NULL;
  v_has_hires    boolean := to_regclass('public.venue_room_hires') IS NOT NULL;
  v_sql          text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  v_sql :=
    'SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.is_active DESC, x.name), ''[]''::jsonb)
       FROM (
         SELECT s.id, s.venue_id, s.name, s.description, s.capacity, s.space_type,
                s.is_enquiry_only, s.enquiry_contact_name, s.enquiry_contact_email,
                s.is_active, s.created_at, ' ||
       CASE WHEN v_has_sessions THEN
         '(SELECT count(*) FROM public.venue_class_sessions cs
             WHERE cs.space_id = s.id AND cs.status <> ''cancelled'' AND cs.starts_at >= now())'
       ELSE '0' END || '::int AS upcoming_session_count, ' ||
       CASE WHEN v_has_hires THEN
         '(SELECT count(*) FROM public.venue_room_hires rh
             WHERE rh.space_id = s.id AND rh.status <> ''cancelled'' AND rh.starts_at >= now())'
       ELSE '0' END || '::int AS upcoming_hire_count
           FROM public.venue_spaces s
          WHERE s.venue_id = $1
       ) x';

  EXECUTE v_sql INTO v_result USING v_caller.venue_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_list_spaces(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_spaces(text) TO anon, authenticated;

-- Refresh PostgREST's function-signature cache.
SELECT pg_notify('pgrst', 'reload schema');
