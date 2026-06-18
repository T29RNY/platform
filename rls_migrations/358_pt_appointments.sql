-- 358_pt_appointments.sql
-- Gym/Boxing vertical, Phase 3 — PT / 1-on-1 appointment booking.
--
-- A trainer is a bookable RESOURCE with recurring weekly availability windows.
-- A member books a single slot inside a window; the slot IS the appointment
-- (dedicated appointments model, NOT capacity=1 classes — capacity=1 classes
-- would force pre-creating every slot, give no bookable trainer identity, and
-- break no-show semantics; decision locked in GYM_VERTICAL_HANDOFF.md).
--
-- Every cross-cutting primitive is REUSED, never reinvented:
--   • operator writes gated via resolve_venue_caller + _venue_has_cap('manage_facility')
--   • member identity via auth.uid() -> member_profiles (booking-grade, like
--     member_book_class_session) — NOT pass_token (that's read-only pass display)
--   • money via the existing venue_charges ledger (source_type='pt'); settlement
--     stays DORMANT until live Stripe keys — 'door' (pay-in-person) is the live path
--   • QR check-in clones venue_class_checkin's pass_token -> venue_memberships bridge
--   • no-show reuses member_profiles.no_show_count + venues.no_show_suspension_threshold
--   • every write INSERTs audit_events (Hard Rule #9)
--
-- TWO INDEPENDENT LEVERS decide who can book (operator decision s147):
--   members_only=true  -> account + active/ending venue_membership (default; "A")
--   members_only=false -> any account; price>0 = door-paid trial/one-off,
--                         price=0 = free open session. ACCOUNT IS ALWAYS REQUIRED.
--
-- All three tables are RLS-walled with NO policies -> every client read/write is
-- blocked; only the SECURITY DEFINER RPCs below reach them.

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_trainers (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                text        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  -- nullable: a trainer is usually a venue_admins staff login, but a club can
  -- also create a no-login "trainer card" (the freelance coach who just turns up)
  admin_id                uuid        REFERENCES public.venue_admins(id) ON DELETE SET NULL,
  display_name            text        NOT NULL CHECK (length(btrim(display_name)) > 0),
  bio                     text,
  default_session_minutes int         NOT NULL DEFAULT 60  CHECK (default_session_minutes > 0),
  price_pence             int         NOT NULL DEFAULT 0   CHECK (price_pence >= 0),
  cancel_cutoff_hours     int         NOT NULL DEFAULT 0   CHECK (cancel_cutoff_hours >= 0),
  members_only            boolean     NOT NULL DEFAULT true,
  active                  boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_trainers_by_venue ON public.venue_trainers (venue_id);

CREATE TABLE IF NOT EXISTS public.venue_trainer_availability (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id   uuid        NOT NULL REFERENCES public.venue_trainers(id) ON DELETE CASCADE,
  day_of_week  smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  slot_minutes int         NOT NULL DEFAULT 60 CHECK (slot_minutes > 0),
  series_start date        NOT NULL DEFAULT current_date,
  series_end   date,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (series_end IS NULL OR series_end >= series_start)
);
CREATE INDEX IF NOT EXISTS venue_trainer_availability_by_trainer
  ON public.venue_trainer_availability (trainer_id);

CREATE TABLE IF NOT EXISTS public.venue_appointments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          text        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  trainer_id        uuid        NOT NULL REFERENCES public.venue_trainers(id) ON DELETE RESTRICT,
  member_profile_id uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE RESTRICT,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            text        NOT NULL DEFAULT 'confirmed'
                                CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  price_pence       int         NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
  payment_mode      text        NOT NULL DEFAULT 'door' CHECK (payment_mode IN ('prepay','door','both')),
  checked_in_at     timestamptz,
  charge_id         uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- one live booking per trainer-slot; cancelled rows don't block re-booking
CREATE UNIQUE INDEX IF NOT EXISTS venue_appointments_one_per_slot
  ON public.venue_appointments (trainer_id, starts_at) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS venue_appointments_by_member ON public.venue_appointments (member_profile_id);
CREATE INDEX IF NOT EXISTS venue_appointments_by_venue_time ON public.venue_appointments (venue_id, starts_at);

ALTER TABLE public.venue_trainers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_trainer_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_appointments         ENABLE ROW LEVEL SECURITY;
-- No policies by design: all client access blocked; SECURITY DEFINER RPCs only.

-- PT bookings write to the shared venue_charges ledger with source_type='pt';
-- extend the allowed set (applied live as 358b_venue_charges_pt_source_type).
ALTER TABLE public.venue_charges DROP CONSTRAINT venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership',
                                  'merchandise','class','room_hire','class_package','pt']));

-- ===========================================================================
-- OPERATOR RPCs (gated manage_facility, audited)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- venue_upsert_trainer — create or edit a trainer (p_trainer_id NULL = create)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_upsert_trainer(
  p_venue_token             text,
  p_trainer_id              uuid    DEFAULT NULL,
  p_display_name            text    DEFAULT NULL,
  p_bio                     text    DEFAULT NULL,
  p_admin_id                uuid    DEFAULT NULL,
  p_default_session_minutes int     DEFAULT 60,
  p_price_pence             int     DEFAULT 0,
  p_cancel_cutoff_hours     int     DEFAULT 0,
  p_members_only            boolean DEFAULT true,
  p_active                  boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_trainer_id IS NULL
     AND (p_display_name IS NULL OR length(btrim(p_display_name)) = 0) THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_default_session_minutes, 60) <= 0 THEN
    RAISE EXCEPTION 'invalid_session_minutes' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_price_pence, 0) < 0 OR COALESCE(p_cancel_cutoff_hours, 0) < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  -- if linking a staff login, it must belong to this venue
  IF p_admin_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.venue_admins
                      WHERE id = p_admin_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'admin_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  IF p_trainer_id IS NULL THEN
    INSERT INTO public.venue_trainers
      (venue_id, admin_id, display_name, bio, default_session_minutes,
       price_pence, cancel_cutoff_hours, members_only, active)
    VALUES
      (v_venue_id, p_admin_id, btrim(p_display_name), NULLIF(btrim(COALESCE(p_bio,'')),''),
       COALESCE(p_default_session_minutes,60), COALESCE(p_price_pence,0),
       COALESCE(p_cancel_cutoff_hours,0), COALESCE(p_members_only,true), COALESCE(p_active,true))
    RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.venue_trainers WHERE id = p_trainer_id AND venue_id = v_venue_id) THEN
      RAISE EXCEPTION 'trainer_not_found' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.venue_trainers SET
      admin_id                = p_admin_id,
      display_name            = COALESCE(NULLIF(btrim(COALESCE(p_display_name,'')),''), display_name),
      bio                     = NULLIF(btrim(COALESCE(p_bio,'')),''),
      default_session_minutes = COALESCE(p_default_session_minutes, default_session_minutes),
      price_pence             = COALESCE(p_price_pence, price_pence),
      cancel_cutoff_hours     = COALESCE(p_cancel_cutoff_hours, cancel_cutoff_hours),
      members_only            = COALESCE(p_members_only, members_only),
      active                  = COALESCE(p_active, active)
    WHERE id = p_trainer_id
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          CASE WHEN p_trainer_id IS NULL THEN 'trainer_created' ELSE 'trainer_updated' END,
          'venue_trainer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'admin_id', p_admin_id,
                             'members_only', COALESCE(p_members_only,true),
                             'price_pence', COALESCE(p_price_pence,0),
                             'active', COALESCE(p_active,true)));

  RETURN jsonb_build_object('ok', true, 'trainer_id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_upsert_trainer(text, uuid, text, text, uuid, int, int, int, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_upsert_trainer(text, uuid, text, text, uuid, int, int, int, boolean, boolean) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- venue_set_trainer_availability — replace ALL recurring windows for a trainer
--   p_windows = jsonb array of {day_of_week,start_time,end_time,slot_minutes,
--                               series_start,series_end}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_set_trainer_availability(
  p_venue_token text,
  p_trainer_id  uuid,
  p_windows     jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_w        jsonb;
  v_count    int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.venue_trainers WHERE id = p_trainer_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'trainer_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_windows IS NULL OR jsonb_typeof(p_windows) <> 'array' THEN
    RAISE EXCEPTION 'windows_required' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.venue_trainer_availability WHERE trainer_id = p_trainer_id;

  FOR v_w IN SELECT * FROM jsonb_array_elements(p_windows) LOOP
    INSERT INTO public.venue_trainer_availability
      (trainer_id, day_of_week, start_time, end_time, slot_minutes, series_start, series_end)
    VALUES (
      p_trainer_id,
      (v_w->>'day_of_week')::smallint,
      (v_w->>'start_time')::time,
      (v_w->>'end_time')::time,
      COALESCE((v_w->>'slot_minutes')::int, 60),
      COALESCE((v_w->>'series_start')::date, current_date),
      NULLIF(v_w->>'series_end','')::date
    );
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'trainer_availability_set', 'venue_trainer', p_trainer_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'windows', v_count));

  RETURN jsonb_build_object('ok', true, 'trainer_id', p_trainer_id, 'windows', v_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_set_trainer_availability(text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_set_trainer_availability(text, uuid, jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- venue_list_trainers — operator read: trainers + availability + upcoming count
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_list_trainers(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_out      jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(trainer ORDER BY trainer->>'display_name'), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT jsonb_build_object(
        'trainer_id',              tr.id,
        'display_name',            tr.display_name,
        'bio',                     tr.bio,
        'admin_id',                tr.admin_id,
        'admin_email',             va.email,
        'default_session_minutes', tr.default_session_minutes,
        'price_pence',             tr.price_pence,
        'cancel_cutoff_hours',     tr.cancel_cutoff_hours,
        'members_only',            tr.members_only,
        'active',                  tr.active,
        'upcoming_count', (
          SELECT count(*) FROM public.venue_appointments ap
           WHERE ap.trainer_id = tr.id AND ap.status = 'confirmed' AND ap.starts_at > now()
        ),
        'availability', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'availability_id', av.id,
                   'day_of_week',     av.day_of_week,
                   'start_time',      av.start_time,
                   'end_time',        av.end_time,
                   'slot_minutes',    av.slot_minutes,
                   'series_start',    av.series_start,
                   'series_end',      av.series_end
                 ) ORDER BY av.day_of_week, av.start_time)
            FROM public.venue_trainer_availability av
           WHERE av.trainer_id = tr.id AND av.is_active
        ), '[]'::jsonb)
      ) AS trainer
      FROM public.venue_trainers tr
      LEFT JOIN public.venue_admins va ON va.id = tr.admin_id
      WHERE tr.venue_id = v_venue_id
    ) q;

  RETURN jsonb_build_object('ok', true, 'trainers', v_out);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_list_trainers(text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_trainers(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- venue_list_appointments — operator read: appointments in a time range
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_list_appointments(
  p_venue_token text,
  p_from        timestamptz,
  p_to          timestamptz
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_out      jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'appointment_id', ap.id,
           'trainer_id',     ap.trainer_id,
           'trainer_name',   tr.display_name,
           'member_profile_id', ap.member_profile_id,
           'member_name',    btrim(coalesce(mp.first_name,'') || ' ' || coalesce(mp.last_name,'')),
           'starts_at',      ap.starts_at,
           'ends_at',        ap.ends_at,
           'status',         ap.status,
           'price_pence',    ap.price_pence,
           'payment_mode',   ap.payment_mode,
           'checked_in_at',  ap.checked_in_at
         ) ORDER BY ap.starts_at), '[]'::jsonb)
    INTO v_out
    FROM public.venue_appointments ap
    JOIN public.venue_trainers tr  ON tr.id = ap.trainer_id
    JOIN public.member_profiles mp ON mp.id = ap.member_profile_id
   WHERE ap.venue_id = v_venue_id
     AND (p_from IS NULL OR ap.starts_at >= p_from)
     AND (p_to   IS NULL OR ap.starts_at <  p_to);

  RETURN jsonb_build_object('ok', true, 'appointments', v_out);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_list_appointments(text, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_appointments(text, timestamptz, timestamptz) TO anon, authenticated;

-- ===========================================================================
-- MEMBER RPCs (auth.uid() -> member_profiles; booking-grade identity)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- member_list_trainers — active trainers at a venue + whether caller is a member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_list_trainers(p_venue_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_member  boolean;
  v_out     jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.venue_memberships
                  WHERE member_profile_id = v_profile AND venue_id = p_venue_id
                    AND status IN ('active','ending')) INTO v_member;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'trainer_id',              tr.id,
           'display_name',            tr.display_name,
           'bio',                     tr.bio,
           'default_session_minutes', tr.default_session_minutes,
           'price_pence',             tr.price_pence,
           'cancel_cutoff_hours',     tr.cancel_cutoff_hours,
           'members_only',            tr.members_only,
           -- can the caller actually book this trainer right now?
           'bookable',                (NOT tr.members_only) OR v_member
         ) ORDER BY tr.display_name), '[]'::jsonb)
    INTO v_out
    FROM public.venue_trainers tr
   WHERE tr.venue_id = p_venue_id AND tr.active;

  RETURN jsonb_build_object('ok', true, 'is_member', v_member, 'trainers', v_out);
END;
$function$;
REVOKE ALL ON FUNCTION public.member_list_trainers(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.member_list_trainers(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- member_list_trainer_slots — expand availability windows minus booked slots
--   Returns future slots in [p_from, p_to] (capped to 62 days).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_list_trainer_slots(
  p_trainer_id uuid,
  p_from       date,
  p_to         date
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_tr      public.venue_trainers;
  v_from    date;
  v_to      date;
  v_w       record;
  v_d       date;
  v_t       time;
  v_start   timestamptz;
  v_end     timestamptz;
  v_slots   jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_tr FROM public.venue_trainers WHERE id = p_trainer_id AND active;
  IF v_tr.id IS NULL THEN RAISE EXCEPTION 'trainer_not_found' USING ERRCODE='P0001'; END IF;

  v_from := GREATEST(COALESCE(p_from, current_date), current_date);
  v_to   := LEAST(COALESCE(p_to, v_from + 14), v_from + 62);

  FOR v_w IN
    SELECT * FROM public.venue_trainer_availability
     WHERE trainer_id = p_trainer_id AND is_active
  LOOP
    v_d := v_from;
    WHILE v_d <= v_to LOOP
      IF EXTRACT(DOW FROM v_d)::int = v_w.day_of_week
         AND v_d >= v_w.series_start
         AND (v_w.series_end IS NULL OR v_d <= v_w.series_end) THEN
        v_t := v_w.start_time;
        WHILE v_t + (v_w.slot_minutes * INTERVAL '1 minute') <= v_w.end_time LOOP
          v_start := (v_d + v_t) AT TIME ZONE 'Europe/London';
          v_end   := v_start + (v_w.slot_minutes * INTERVAL '1 minute');
          IF v_start > now()
             AND NOT EXISTS (SELECT 1 FROM public.venue_appointments ap
                              WHERE ap.trainer_id = p_trainer_id
                                AND ap.starts_at = v_start
                                AND ap.status <> 'cancelled') THEN
            v_slots := v_slots || jsonb_build_object(
              'starts_at', v_start, 'ends_at', v_end,
              'slot_minutes', v_w.slot_minutes, 'price_pence', v_tr.price_pence);
          END IF;
          v_t := v_t + (v_w.slot_minutes * INTERVAL '1 minute');
        END LOOP;
      END IF;
      v_d := v_d + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'trainer_id', p_trainer_id, 'slots', v_slots);
END;
$function$;
REVOKE ALL ON FUNCTION public.member_list_trainer_slots(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.member_list_trainer_slots(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- member_book_appointment — book one slot; writes venue_charges (source_type='pt')
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_book_appointment(
  p_trainer_id uuid,
  p_starts_at  timestamptz
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   public.member_profiles;
  v_tr        public.venue_trainers;
  v_local_d   date;
  v_local_t   time;
  v_w         record;
  v_slot_min  int;
  v_ends      timestamptz;
  v_member    boolean;
  v_threshold int;
  v_appt_id   uuid;
  v_charge_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_tr FROM public.venue_trainers WHERE id = p_trainer_id AND active;
  IF v_tr.id IS NULL THEN RAISE EXCEPTION 'trainer_not_found' USING ERRCODE='P0001'; END IF;

  IF p_starts_at IS NULL OR p_starts_at <= now() THEN
    RAISE EXCEPTION 'slot_in_past' USING ERRCODE='P0001';
  END IF;

  -- membership lever: members_only trainers need an active/ending membership;
  -- open trainers need only an account (already proven above)
  SELECT EXISTS (SELECT 1 FROM public.venue_memberships
                  WHERE member_profile_id = v_profile.id AND venue_id = v_tr.venue_id
                    AND status IN ('active','ending')) INTO v_member;
  IF v_tr.members_only AND NOT v_member THEN
    RAISE EXCEPTION 'membership_required' USING ERRCODE='P0001';
  END IF;

  -- no-show suspension (reuses the class threshold)
  SELECT no_show_suspension_threshold INTO v_threshold FROM public.venues WHERE id = v_tr.venue_id;
  IF v_threshold IS NOT NULL AND v_profile.no_show_count >= v_threshold THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suspended', 'no_show_count', v_profile.no_show_count);
  END IF;

  -- validate the requested time is a real slot boundary inside a window
  v_local_d := (p_starts_at AT TIME ZONE 'Europe/London')::date;
  v_local_t := (p_starts_at AT TIME ZONE 'Europe/London')::time;
  SELECT * INTO v_w FROM public.venue_trainer_availability av
   WHERE av.trainer_id = p_trainer_id AND av.is_active
     AND av.day_of_week = EXTRACT(DOW FROM v_local_d)::int
     AND v_local_d >= av.series_start
     AND (av.series_end IS NULL OR v_local_d <= av.series_end)
     AND v_local_t >= av.start_time
     AND v_local_t + (av.slot_minutes * INTERVAL '1 minute') <= av.end_time
     AND mod(EXTRACT(EPOCH FROM (v_local_t - av.start_time))::int, av.slot_minutes * 60) = 0
   ORDER BY av.start_time
   LIMIT 1;
  IF v_w.id IS NULL THEN
    RAISE EXCEPTION 'not_a_valid_slot' USING ERRCODE='P0001';
  END IF;
  v_slot_min := v_w.slot_minutes;
  v_ends := p_starts_at + (v_slot_min * INTERVAL '1 minute');

  -- insert; the partial-unique index rejects a double-book as unique_violation
  BEGIN
    INSERT INTO public.venue_appointments
      (venue_id, trainer_id, member_profile_id, starts_at, ends_at, status,
       price_pence, payment_mode)
    VALUES
      (v_tr.venue_id, p_trainer_id, v_profile.id, p_starts_at, v_ends, 'confirmed',
       v_tr.price_pence, 'door')
    RETURNING id INTO v_appt_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slot_taken');
  END;

  -- money: write a venue_charges row when there's something to pay (door path).
  -- Settlement stays DORMANT until live keys; the ledger row is the source of truth.
  IF v_tr.price_pence > 0 THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_tr.venue_id, 'pt', v_appt_id::text, v_tr.price_pence, 'unpaid', p_starts_at::date)
    RETURNING id INTO v_charge_id;
    UPDATE public.venue_appointments SET charge_id = v_charge_id WHERE id = v_appt_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_tr.venue_id, v_uid, 'player', 'member_appointment_booked', 'venue_appointment', v_appt_id::text,
          jsonb_build_object('trainer_id', p_trainer_id, 'member_profile_id', v_profile.id,
                             'starts_at', p_starts_at, 'price_pence', v_tr.price_pence,
                             'charge_id', v_charge_id, 'members_only', v_tr.members_only));

  RETURN jsonb_build_object('ok', true, 'appointment_id', v_appt_id, 'status', 'confirmed',
                            'starts_at', p_starts_at, 'ends_at', v_ends,
                            'price_pence', v_tr.price_pence, 'charge_id', v_charge_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.member_book_appointment(uuid, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.member_book_appointment(uuid, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- member_cancel_appointment — cancel own appointment (honours cutoff), refunds
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_cancel_appointment(p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_profile  uuid;
  v_ap       public.venue_appointments;
  v_cutoff   int;
  v_refunded int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_ap FROM public.venue_appointments WHERE id = p_appointment_id;
  IF v_ap.id IS NULL OR v_ap.member_profile_id <> v_profile THEN
    RAISE EXCEPTION 'appointment_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_ap.status <> 'confirmed' THEN
    RAISE EXCEPTION 'not_cancellable' USING ERRCODE='P0001';
  END IF;

  SELECT cancel_cutoff_hours INTO v_cutoff FROM public.venue_trainers WHERE id = v_ap.trainer_id;
  IF COALESCE(v_cutoff,0) > 0 AND now() > v_ap.starts_at - (v_cutoff * INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'cutoff_passed' USING ERRCODE='P0001';
  END IF;

  UPDATE public.venue_appointments SET status = 'cancelled' WHERE id = p_appointment_id;
  UPDATE public.venue_charges SET status = 'refunded'
   WHERE source_type = 'pt' AND source_id = p_appointment_id::text AND status <> 'refunded';
  GET DIAGNOSTICS v_refunded = ROW_COUNT;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_ap.venue_id, v_uid, 'player', 'member_appointment_cancelled', 'venue_appointment', p_appointment_id::text,
          jsonb_build_object('trainer_id', v_ap.trainer_id, 'member_profile_id', v_profile,
                             'starts_at', v_ap.starts_at, 'refunded', v_refunded));

  RETURN jsonb_build_object('ok', true, 'appointment_id', p_appointment_id, 'refunded', v_refunded);
END;
$function$;
REVOKE ALL ON FUNCTION public.member_cancel_appointment(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.member_cancel_appointment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- member_list_my_appointments — caller's own upcoming/recent appointments
--   (applied live as 358c_member_list_my_appointments)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_list_my_appointments(p_venue_id text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile uuid; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'appointment_id', ap.id, 'trainer_id', ap.trainer_id, 'trainer_name', tr.display_name,
    'venue_id', ap.venue_id, 'starts_at', ap.starts_at, 'ends_at', ap.ends_at,
    'status', ap.status, 'price_pence', ap.price_pence, 'checked_in_at', ap.checked_in_at,
    'cancel_cutoff_hours', tr.cancel_cutoff_hours) ORDER BY ap.starts_at), '[]'::jsonb) INTO v_out
    FROM public.venue_appointments ap JOIN public.venue_trainers tr ON tr.id = ap.trainer_id
   WHERE ap.member_profile_id = v_profile
     AND (p_venue_id IS NULL OR ap.venue_id = p_venue_id)
     AND ap.starts_at >= now() - INTERVAL '1 day';
  RETURN jsonb_build_object('ok', true, 'appointments', v_out);
END;
$function$;
REVOKE ALL ON FUNCTION public.member_list_my_appointments(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.member_list_my_appointments(text) TO authenticated;

-- ===========================================================================
-- OPERATOR check-in + completion (gated: manager OR the trainer's own login)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- venue_pt_checkin — QR check-in (clone of venue_class_checkin bridge)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_pt_checkin(
  p_venue_token    text,
  p_appointment_id uuid,
  p_pass_token     text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     record;
  v_ap         public.venue_appointments;
  v_tr         public.venue_trainers;
  v_is_manager boolean;
  v_admin_id   uuid;
  v_token      text;
  v_mp_id      uuid;
  v_mp_venue   text;
  v_member_nm  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.venue_appointments WHERE id = p_appointment_id;
  IF NOT FOUND OR v_ap.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'appointment_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_ap.status = 'cancelled' THEN RAISE EXCEPTION 'appointment_cancelled' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_tr FROM public.venue_trainers WHERE id = v_ap.trainer_id;

  v_is_manager := v_caller.actor_type = 'platform_admin'
               OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility');
  IF NOT v_is_manager THEN
    SELECT id INTO v_admin_id FROM public.venue_admins
      WHERE user_id = auth.uid() AND venue_id = v_caller.venue_id
        AND status = 'active' AND revoked_at IS NULL LIMIT 1;
    IF v_admin_id IS NULL OR v_tr.admin_id IS NULL OR v_admin_id <> v_tr.admin_id THEN
      RAISE EXCEPTION 'not_trainer' USING ERRCODE='P0001';
    END IF;
  END IF;

  v_token := regexp_replace(COALESCE(p_pass_token, ''), '^.*/m/', '');
  v_token := split_part(v_token, '?', 1);
  v_token := btrim(v_token);
  IF v_token = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_token'); END IF;

  SELECT member_profile_id, venue_id INTO v_mp_id, v_mp_venue
    FROM public.venue_memberships WHERE pass_token = v_token LIMIT 1;
  IF v_mp_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'pass_not_found'); END IF;
  IF v_mp_venue <> v_caller.venue_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_venue'); END IF;

  SELECT btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) INTO v_member_nm
    FROM public.member_profiles WHERE id = v_mp_id;

  IF v_ap.member_profile_id <> v_mp_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_member', 'member_name', v_member_nm);
  END IF;
  IF v_ap.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_checked_in', true, 'member_name', v_member_nm);
  END IF;

  UPDATE public.venue_appointments SET checked_in_at = now() WHERE id = p_appointment_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_pt_checkin', 'venue_appointment', p_appointment_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'trainer_id', v_ap.trainer_id,
                             'member_profile_id', v_mp_id, 'via', 'qr'));

  RETURN jsonb_build_object('ok', true, 'already_checked_in', false, 'member_name', v_member_nm);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_pt_checkin(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_pt_checkin(text, uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- venue_mark_appointment_completed — complete or no-show (no-show bumps count)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_mark_appointment_completed(
  p_venue_token    text,
  p_appointment_id uuid,
  p_no_show        boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     record;
  v_ap         public.venue_appointments;
  v_tr         public.venue_trainers;
  v_is_manager boolean;
  v_admin_id   uuid;
  v_new_status text;
  v_no_show    int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.venue_appointments WHERE id = p_appointment_id;
  IF NOT FOUND OR v_ap.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'appointment_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_ap.status <> 'confirmed' THEN
    RAISE EXCEPTION 'not_completable' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_tr FROM public.venue_trainers WHERE id = v_ap.trainer_id;
  v_is_manager := v_caller.actor_type = 'platform_admin'
               OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility');
  IF NOT v_is_manager THEN
    SELECT id INTO v_admin_id FROM public.venue_admins
      WHERE user_id = auth.uid() AND venue_id = v_caller.venue_id
        AND status = 'active' AND revoked_at IS NULL LIMIT 1;
    IF v_admin_id IS NULL OR v_tr.admin_id IS NULL OR v_admin_id <> v_tr.admin_id THEN
      RAISE EXCEPTION 'not_trainer' USING ERRCODE='P0001';
    END IF;
  END IF;

  IF COALESCE(p_no_show, false) THEN
    v_new_status := 'no_show';
    UPDATE public.member_profiles
       SET no_show_count = no_show_count + 1
     WHERE id = v_ap.member_profile_id
    RETURNING no_show_count INTO v_no_show;
    -- no-show KEEPS the venue_charges row (the slot was held; decision s147)
  ELSE
    v_new_status := 'completed';
  END IF;

  UPDATE public.venue_appointments SET status = v_new_status WHERE id = p_appointment_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_appointment_completed', 'venue_appointment', p_appointment_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'trainer_id', v_ap.trainer_id,
                             'member_profile_id', v_ap.member_profile_id,
                             'status', v_new_status, 'no_show_count', v_no_show));

  RETURN jsonb_build_object('ok', true, 'appointment_id', p_appointment_id,
                            'status', v_new_status, 'no_show_count', v_no_show);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_mark_appointment_completed(text, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_mark_appointment_completed(text, uuid, boolean) TO anon, authenticated;
