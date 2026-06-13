-- Migration 298 — Phase 10 Club Attendance: Slice 1
-- Tables: club_sessions, club_session_rsvps, club_session_attendance
-- Admin RPCs (9): club_create/list/update_cohort, club_create/update/cancel_session,
--                 club_list_sessions, club_get_session_rsvps, club_mark_attendance
-- Demo seed: 2 cohorts (Adults, Juniors) + 2 upcoming sessions on club_demo
-- Auth pattern: resolve_venue_caller(p_venue_token) + _venue_has_cap('manage_memberships')
-- Audit pattern: actor_user_id / actor_type / actor_identifier / action / entity_type / entity_id / metadata

-- ─── 1. club_sessions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.club_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  cohort_id        uuid        REFERENCES public.club_cohorts(id) ON DELETE SET NULL,
  title            text        NOT NULL,
  scheduled_at     timestamptz NOT NULL,
  location         text,
  notes            text,
  capacity         integer,
  status           text        NOT NULL DEFAULT 'scheduled',
  cancelled_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_sessions_status_check CHECK (status IN ('scheduled','cancelled'))
);

ALTER TABLE public.club_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_sessions FROM anon, authenticated;

-- ─── 2. club_session_rsvps ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.club_session_rsvps (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid        NOT NULL REFERENCES public.club_sessions(id) ON DELETE CASCADE,
  member_profile_id   uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  rsvp_by_profile_id  uuid        REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  status              text        NOT NULL DEFAULT 'pending',
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_session_rsvps_status_check CHECK (status IN ('in','out','maybe','pending')),
  CONSTRAINT uq_session_rsvp_member UNIQUE (session_id, member_profile_id)
);

ALTER TABLE public.club_session_rsvps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_session_rsvps FROM anon, authenticated;

-- ─── 3. club_session_attendance ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.club_session_attendance (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        NOT NULL REFERENCES public.club_sessions(id) ON DELETE CASCADE,
  member_profile_id uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  status            text        NOT NULL,
  marked_by_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_session_attendance_status_check CHECK (status IN ('attended','absent','late')),
  CONSTRAINT uq_session_attendance_member UNIQUE (session_id, member_profile_id)
);

ALTER TABLE public.club_session_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_session_attendance FROM anon, authenticated;

-- ─── 4. club_create_cohort ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_create_cohort(
  p_venue_token text,
  p_club_id     text,
  p_name        text,
  p_description text    DEFAULT NULL,
  p_min_age     integer DEFAULT NULL,
  p_max_age     integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.club_create_cohort(text,text,text,text,integer,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_create_cohort(text,text,text,text,integer,integer) TO anon, authenticated;

-- ─── 5. club_list_cohorts ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_list_cohorts(
  p_venue_token      text,
  p_club_id          text,
  p_include_inactive boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.club_list_cohorts(text,text,boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_list_cohorts(text,text,boolean) TO anon, authenticated;

-- ─── 6. club_update_cohort ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_update_cohort(
  p_venue_token text,
  p_cohort_id   uuid,
  p_name        text    DEFAULT NULL,
  p_description text    DEFAULT NULL,
  p_min_age     integer DEFAULT NULL,
  p_max_age     integer DEFAULT NULL,
  p_active      boolean DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_cohort_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  -- Ownership via cohort → club → club_venues; update in one shot
  UPDATE public.club_cohorts cc SET
    name        = COALESCE(NULLIF(btrim(p_name), ''), cc.name),
    description = COALESCE(p_description, cc.description),
    min_age     = COALESCE(p_min_age, cc.min_age),
    max_age     = COALESCE(p_max_age, cc.max_age),
    active      = COALESCE(p_active, cc.active)
  FROM public.club_venues cv
  WHERE cc.id = p_cohort_id
    AND cv.club_id = cc.club_id
    AND cv.venue_id = v_venue_id
  RETURNING cc.id INTO v_cohort_id;

  IF v_cohort_id IS NULL THEN RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_cohort_updated', 'club_cohort', v_cohort_id::text,
          jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'cohort_id', v_cohort_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_update_cohort(text,uuid,text,text,integer,integer,boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_update_cohort(text,uuid,text,text,integer,integer,boolean) TO anon, authenticated;

-- ─── 7. club_create_session ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_create_session(
  p_venue_token  text,
  p_club_id      text,
  p_title        text,
  p_scheduled_at timestamptz,
  p_cohort_id    uuid    DEFAULT NULL,
  p_location     text    DEFAULT NULL,
  p_notes        text    DEFAULT NULL,
  p_capacity     integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_session_id uuid;
  v_title      text := NULLIF(btrim(p_title), '');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001'; END IF;
  IF p_scheduled_at IS NULL THEN RAISE EXCEPTION 'scheduled_at_required' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_cohorts WHERE id = p_cohort_id AND club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'cohort_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_sessions (club_id, cohort_id, title, scheduled_at, location, notes, capacity)
  VALUES (p_club_id, p_cohort_id, v_title, p_scheduled_at, p_location, p_notes, p_capacity)
  RETURNING id INTO v_session_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_session_created', 'club_session', v_session_id::text,
          jsonb_build_object('club_id', p_club_id, 'title', v_title, 'scheduled_at', p_scheduled_at));
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_create_session(text,text,text,timestamptz,uuid,text,text,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_create_session(text,text,text,timestamptz,uuid,text,text,integer) TO anon, authenticated;

-- ─── 8. club_update_session ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_update_session(
  p_venue_token  text,
  p_session_id   uuid,
  p_title        text        DEFAULT NULL,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_location     text        DEFAULT NULL,
  p_notes        text        DEFAULT NULL,
  p_capacity     integer     DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  -- Ownership via session → club → club_venues; only updates non-cancelled sessions
  UPDATE public.club_sessions cs SET
    title        = COALESCE(NULLIF(btrim(p_title), ''), cs.title),
    scheduled_at = COALESCE(p_scheduled_at, cs.scheduled_at),
    location     = COALESCE(p_location, cs.location),
    notes        = COALESCE(p_notes, cs.notes),
    capacity     = COALESCE(p_capacity, cs.capacity),
    updated_at   = now()
  FROM public.club_venues cv
  WHERE cs.id = p_session_id
    AND cv.club_id = cs.club_id
    AND cv.venue_id = v_venue_id
    AND cs.status = 'scheduled'
  RETURNING cs.id INTO v_session_id;

  IF v_session_id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_session_updated', 'club_session', v_session_id::text,
          jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_update_session(text,uuid,text,timestamptz,text,text,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_update_session(text,uuid,text,timestamptz,text,text,integer) TO anon, authenticated;

-- ─── 9. club_cancel_session ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_cancel_session(
  p_venue_token text,
  p_session_id  uuid,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.club_sessions cs SET
    status           = 'cancelled',
    cancelled_reason = p_reason,
    updated_at       = now()
  FROM public.club_venues cv
  WHERE cs.id = p_session_id
    AND cv.club_id = cs.club_id
    AND cv.venue_id = v_venue_id
    AND cs.status = 'scheduled'
  RETURNING cs.id INTO v_session_id;

  IF v_session_id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_session_cancelled', 'club_session', v_session_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_cancel_session(text,uuid,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_cancel_session(text,uuid,text) TO anon, authenticated;

-- ─── 10. club_list_sessions ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.club_list_sessions(
  p_venue_token text,
  p_club_id     text,
  p_cohort_id   uuid        DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
        'session_id',        cs.id,
        'club_id',           cs.club_id,
        'cohort_id',         cs.cohort_id,
        'cohort_name',       cc.name,
        'title',             cs.title,
        'scheduled_at',      cs.scheduled_at,
        'location',          cs.location,
        'notes',             cs.notes,
        'capacity',          cs.capacity,
        'status',            cs.status,
        'cancelled_reason',  cs.cancelled_reason,
        'rsvp_in',           (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'in'),
        'rsvp_out',          (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'out'),
        'rsvp_maybe',        (SELECT count(*) FROM public.club_session_rsvps r WHERE r.session_id = cs.id AND r.status = 'maybe'),
        'attendance_marked', EXISTS (SELECT 1 FROM public.club_session_attendance a WHERE a.session_id = cs.id)
      ) ORDER BY cs.scheduled_at
    ), '[]'::jsonb)
    FROM public.club_sessions cs
    LEFT JOIN public.club_cohorts cc ON cc.id = cs.cohort_id
    WHERE cs.club_id = p_club_id
      AND (p_cohort_id IS NULL OR cs.cohort_id = p_cohort_id)
      AND (p_from IS NULL OR cs.scheduled_at >= p_from)
      AND (p_to   IS NULL OR cs.scheduled_at <= p_to)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_list_sessions(text,text,uuid,timestamptz,timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_list_sessions(text,text,uuid,timestamptz,timestamptz) TO anon, authenticated;

-- ─── 11. club_get_session_rsvps ──────────────────────────────────────────────
-- Returns first names only (operator decision: same-club members see first names only).

CREATE OR REPLACE FUNCTION public.club_get_session_rsvps(
  p_venue_token text,
  p_session_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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

  SELECT cs.club_id INTO v_club_id
  FROM public.club_sessions cs
  JOIN public.club_venues cv ON cv.club_id = cs.club_id AND cv.venue_id = v_venue_id
  WHERE cs.id = p_session_id;

  IF v_club_id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'rsvps', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'rsvp_id',           r.id,
          'member_profile_id', r.member_profile_id,
          'first_name',        mp.first_name,
          'status',            r.status,
          'note',              r.note,
          'updated_at',        r.updated_at
        ) ORDER BY mp.first_name, mp.last_name
      )
      FROM public.club_session_rsvps r
      JOIN public.member_profiles mp ON mp.id = r.member_profile_id
      WHERE r.session_id = p_session_id
    ), '[]'::jsonb),
    'attendance', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'member_profile_id', a.member_profile_id,
          'first_name',        mp.first_name,
          'status',            a.status,
          'marked_at',         a.marked_at
        ) ORDER BY mp.first_name, mp.last_name
      )
      FROM public.club_session_attendance a
      JOIN public.member_profiles mp ON mp.id = a.member_profile_id
      WHERE a.session_id = p_session_id
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_get_session_rsvps(text,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_get_session_rsvps(text,uuid) TO anon, authenticated;

-- ─── 12. club_mark_attendance ────────────────────────────────────────────────
-- p_attendances: [{member_profile_id: uuid, status: 'attended'|'absent'|'late'}]
-- Upserts on conflict — idempotent re-marking.

CREATE OR REPLACE FUNCTION public.club_mark_attendance(
  p_venue_token text,
  p_session_id  uuid,
  p_attendances jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_club_id    text;
  v_row        jsonb;
  v_count      integer := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT cs.club_id INTO v_club_id
  FROM public.club_sessions cs
  JOIN public.club_venues cv ON cv.club_id = cs.club_id AND cv.venue_id = v_venue_id
  WHERE cs.id = p_session_id AND cs.status = 'scheduled';

  IF v_club_id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0001'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_attendances) LOOP
    IF (v_row->>'status') NOT IN ('attended','absent','late') THEN
      RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.club_session_attendance
      (session_id, member_profile_id, status, marked_by_user_id)
    VALUES (
      p_session_id,
      (v_row->>'member_profile_id')::uuid,
      v_row->>'status',
      auth.uid()
    )
    ON CONFLICT (session_id, member_profile_id)
      DO UPDATE SET
        status            = EXCLUDED.status,
        marked_by_user_id = EXCLUDED.marked_by_user_id,
        marked_at         = now();
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_attendance_marked', 'club_session', p_session_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', v_club_id, 'count', v_count));
  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'marked', v_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_mark_attendance(text,uuid,jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.club_mark_attendance(text,uuid,jsonb) TO anon, authenticated;

-- ─── 13. Demo seed ───────────────────────────────────────────────────────────
-- Deterministic UUIDs: cohorts in 0f000000... range (0001 = U12s from mig 288)
-- Sessions use 0f100000... range to keep namespaces separate.

INSERT INTO public.club_cohorts (id, club_id, name, description, active)
VALUES
  ('0f000000-0000-4000-8000-000000000002', 'club_demo', 'Adults',  'Adult members training group',          true),
  ('0f000000-0000-4000-8000-000000000003', 'club_demo', 'Juniors', 'Junior training squad (13-17)', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.club_sessions (id, club_id, cohort_id, title, scheduled_at, location, capacity)
VALUES
  ('0f100000-0000-4000-8000-000000000001', 'club_demo',
   '0f000000-0000-4000-8000-000000000002',
   'Tuesday Adults Training',
   now() + interval '7 days', 'Main Hall', 20),
  ('0f100000-0000-4000-8000-000000000002', 'club_demo',
   '0f000000-0000-4000-8000-000000000003',
   'Saturday Juniors Session',
   now() + interval '9 days', 'Sports Hall B', 15)
ON CONFLICT (id) DO NOTHING;
