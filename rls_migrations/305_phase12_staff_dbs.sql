-- Migration 305: Phase 12 — Club Staff + DBS
-- Adds club_staff_dbs table and five RPCs:
--   venue_assign_team_manager   (venue token, manage_memberships cap)
--   venue_remove_team_manager   (venue token, manage_memberships cap)
--   venue_list_club_staff       (venue token, read-only)
--   venue_upsert_staff_dbs      (venue token, manage_memberships cap)
--   expire_staff_dbs            (service_role only, called by cron)

-- ─── 1. club_staff_dbs ───────────────────────────────────────────────────────

CREATE TABLE public.club_staff_dbs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_profile_id   uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  club_id             text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  check_type          text        NOT NULL CHECK (check_type IN ('basic','standard','enhanced','enhanced_barred')),
  certificate_number  text,
  issued_date         date,
  expiry_date         date,
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','valid','expired','withdrawn')),
  notes               text,
  recorded_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_profile_id, club_id)
);

CREATE INDEX club_staff_dbs_club_idx ON public.club_staff_dbs (club_id);
ALTER TABLE public.club_staff_dbs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_staff_dbs FROM anon, authenticated;

-- ─── 2. venue_assign_team_manager ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_assign_team_manager(
  p_token             text,
  p_team_id           uuid,
  p_member_profile_id uuid,
  p_role              text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_club_id   text;
  v_manager_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_role NOT IN ('manager','assistant_manager','coach') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='P0001';
  END IF;

  -- Confirm team belongs to a club at this venue
  SELECT ct.club_id INTO v_club_id
  FROM public.club_teams ct
  JOIN public.club_venues cv ON cv.club_id = ct.club_id
  WHERE ct.id = p_team_id AND cv.venue_id = v_venue_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001';
  END IF;

  -- Member must have an active membership in this club
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_memberships
    WHERE member_profile_id = p_member_profile_id
      AND club_id = v_club_id
      AND status IN ('active','ending')
  ) THEN
    RAISE EXCEPTION 'member_not_enrolled' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.club_team_managers (team_id, member_profile_id, role, is_active)
  VALUES (p_team_id, p_member_profile_id, p_role, true)
  ON CONFLICT (team_id, member_profile_id)
    DO UPDATE SET role = p_role, is_active = true, assigned_at = now()
  RETURNING id INTO v_manager_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'staff_assigned', 'club_team_manager', v_manager_id::text,
          jsonb_build_object('team_id', p_team_id, 'member_profile_id', p_member_profile_id, 'role', p_role));

  RETURN jsonb_build_object('ok', true, 'manager_id', v_manager_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_assign_team_manager(text, uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_assign_team_manager(text, uuid, uuid, text) TO anon, authenticated;

-- ─── 3. venue_remove_team_manager ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_remove_team_manager(
  p_token             text,
  p_team_id           uuid,
  p_member_profile_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club_id  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;

  -- Confirm team belongs to a club at this venue
  SELECT ct.club_id INTO v_club_id
  FROM public.club_teams ct
  JOIN public.club_venues cv ON cv.club_id = ct.club_id
  WHERE ct.id = p_team_id AND cv.venue_id = v_venue_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001';
  END IF;

  UPDATE public.club_team_managers
  SET is_active = false
  WHERE team_id = p_team_id AND member_profile_id = p_member_profile_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'staff_removed', 'club_team_manager', p_member_profile_id::text,
          jsonb_build_object('team_id', p_team_id, 'member_profile_id', p_member_profile_id));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_remove_team_manager(text, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_remove_team_manager(text, uuid, uuid) TO anon, authenticated;

-- ─── 4. venue_list_club_staff ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_list_club_staff(
  p_token   text,
  p_club_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Confirm club is linked to this venue
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'team_id',          ct.id,
        'team_name',        ct.name,
        'cohort_id',        ct.cohort_id,
        'manager_id',       ctm.id,
        'member_profile_id', mp.id,
        'first_name',       mp.first_name,
        'last_name',        mp.last_name,
        'role',             ctm.role,
        'is_active',        ctm.is_active,
        'dbs_id',           dbs.id,
        'dbs_status',       dbs.status,
        'dbs_check_type',   dbs.check_type,
        'dbs_expiry_date',  dbs.expiry_date
      ) ORDER BY ct.name, mp.first_name, mp.last_name
    )
    FROM public.club_team_managers ctm
    JOIN public.club_teams ct ON ct.id = ctm.team_id
    JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
    LEFT JOIN public.club_staff_dbs dbs
      ON dbs.member_profile_id = ctm.member_profile_id AND dbs.club_id = p_club_id
    WHERE ct.club_id = p_club_id
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_list_club_staff(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_list_club_staff(text, text) TO anon, authenticated;

-- ─── 5. venue_upsert_staff_dbs ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_upsert_staff_dbs(
  p_token               text,
  p_member_profile_id   uuid,
  p_club_id             text,
  p_check_type          text,
  p_status              text,
  p_certificate_number  text    DEFAULT NULL,
  p_issued_date         date    DEFAULT NULL,
  p_expiry_date         date    DEFAULT NULL,
  p_notes               text    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_dbs_id   uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_check_type NOT IN ('basic','standard','enhanced','enhanced_barred') THEN
    RAISE EXCEPTION 'invalid_check_type' USING ERRCODE='P0001';
  END IF;
  IF p_status NOT IN ('pending','valid','expired','withdrawn') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='P0001';
  END IF;

  -- Confirm club is linked to this venue
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues
    WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE='P0001';
  END IF;

  -- Confirm member profile exists
  IF NOT EXISTS (SELECT 1 FROM public.member_profiles WHERE id = p_member_profile_id) THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.club_staff_dbs
    (member_profile_id, club_id, check_type, status, certificate_number,
     issued_date, expiry_date, notes, recorded_by, recorded_at, updated_at)
  VALUES
    (p_member_profile_id, p_club_id, p_check_type, p_status, p_certificate_number,
     p_issued_date, p_expiry_date, p_notes, auth.uid(), now(), now())
  ON CONFLICT (member_profile_id, club_id) DO UPDATE SET
    check_type         = p_check_type,
    status             = p_status,
    certificate_number = p_certificate_number,
    issued_date        = p_issued_date,
    expiry_date        = p_expiry_date,
    notes              = p_notes,
    recorded_by        = auth.uid(),
    updated_at         = now()
  RETURNING id INTO v_dbs_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'staff_dbs_recorded', 'club_staff_dbs', v_dbs_id::text,
          jsonb_build_object('member_profile_id', p_member_profile_id, 'club_id', p_club_id,
                             'check_type', p_check_type, 'status', p_status));

  RETURN jsonb_build_object('ok', true, 'dbs_id', v_dbs_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.venue_upsert_staff_dbs(text, uuid, text, text, text, text, date, date, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_upsert_staff_dbs(text, uuid, text, text, text, text, date, date, text) TO anon, authenticated;

-- ─── 6. expire_staff_dbs (service_role only — called by cron) ────────────────

CREATE OR REPLACE FUNCTION public.expire_staff_dbs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_count int;
BEGIN
  UPDATE public.club_staff_dbs
  SET status = 'expired', updated_at = now()
  WHERE status = 'valid' AND expiry_date < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('expired', v_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.expire_staff_dbs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_staff_dbs() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_staff_dbs() TO service_role;
