-- 339_class_types_scheduling.sql
--
-- Classes Booking + Room Hire — Phase 2: Class types & scheduling.
--
-- Builds the venue-operator side of classes: the class catalogue
-- (`venue_class_types`), recurring templates (`venue_class_series`) and the
-- concrete bookable instances (`venue_class_sessions`), plus the 11 venue-admin
-- RPCs that drive them. Member booking (`venue_class_bookings`), the
-- `member_profiles.no_show_count` column and `venues.no_show_suspension_threshold`
-- all land in Phase 3 (mig 340).
--
-- Forward-safety (mirrors mig 338's _space_is_available pattern): two cascades
-- here depend on Phase-3/Phase-6 objects that do not exist yet —
--   • venue_cancel_class_session / _series must VOID+REFUND the prepaid
--     `venue_charges` rows of each booked member (not merely notify), and
--   • venue_mark_class_completed must flip every un-checked-in `confirmed`
--     booking to `no_show` and bump `member_profiles.no_show_count`.
-- Both reference `venue_class_bookings` (Phase 3). Each is wrapped in a
-- `to_regclass('public.venue_class_bookings') IS NOT NULL` guard with dynamic
-- SQL, so the RPCs create and run cleanly now (cascades are genuine no-ops —
-- no bookings/class-charges exist yet) and begin enforcing automatically the
-- instant Phase 3 lands the table + columns. No signature or body change in a
-- later phase. The no-show flip additionally honours a future
-- `venue_class_bookings.checked_in_at` column (Phase 6 check-in) via a runtime
-- column-existence probe — recorded as a consumer contract in RPCS.md
-- (Hard Rule #14): Phase 6 check-in MUST stamp `checked_in_at` so attendees are
-- excluded from the no-show flip.
--
-- Charge contract (recorded for Phase 3, Hard Rule #14): member_book_class_session
-- creates a `venue_charges` row with source_type='class' and
-- source_id = <venue_class_bookings.id>::text. The refund cascade below keys on
-- exactly that shape.

-- ── 1. venue_charges.source_type += 'class' ─────────────────────────────────

ALTER TABLE public.venue_charges DROP CONSTRAINT venue_charges_source_type_check;
ALTER TABLE public.venue_charges ADD  CONSTRAINT venue_charges_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','fixture','equipment','fee','membership','merchandise','class']));

-- ── 2. venue_class_types ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_class_types (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                  text        NOT NULL REFERENCES public.venues(id)       ON DELETE CASCADE,
  space_id                  uuid        NOT NULL REFERENCES public.venue_spaces(id)  ON DELETE CASCADE,
  name                      text        NOT NULL,
  description               text,
  category                  text        NOT NULL CHECK (category IN ('fitness','yoga','dance','martial_arts','other')),
  duration_minutes          int         NOT NULL CHECK (duration_minutes > 0),
  default_capacity          int         NOT NULL CHECK (default_capacity >= 0),
  cancellation_cutoff_hours int         NOT NULL DEFAULT 2 CHECK (cancellation_cutoff_hours >= 0),
  first_session_free        boolean     NOT NULL DEFAULT false,
  is_active                 boolean     NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_class_types_venue_idx ON public.venue_class_types (venue_id);

-- ── 3. venue_class_series (recurring template) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_class_series (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_type_id uuid        NOT NULL REFERENCES public.venue_class_types(id) ON DELETE CASCADE,
  instructor_id uuid        NOT NULL REFERENCES public.venue_admins(id)      ON DELETE RESTRICT,
  day_of_week   smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    time        NOT NULL,
  series_start  date        NOT NULL,
  series_end    date,
  price_pence   int         NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
  payment_mode  text        NOT NULL CHECK (payment_mode IN ('prepay','door','both')),
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_class_series_type_idx ON public.venue_class_series (class_type_id);

-- ── 4. venue_class_sessions (concrete instance) ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_class_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            text        NOT NULL REFERENCES public.venues(id)            ON DELETE CASCADE,
  class_type_id       uuid        NOT NULL REFERENCES public.venue_class_types(id) ON DELETE CASCADE,
  series_id           uuid        REFERENCES public.venue_class_series(id)         ON DELETE SET NULL,
  instructor_id       uuid        NOT NULL REFERENCES public.venue_admins(id)      ON DELETE RESTRICT,
  space_id            uuid        NOT NULL REFERENCES public.venue_spaces(id)      ON DELETE RESTRICT,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  capacity            int         NOT NULL CHECK (capacity >= 0),
  status              text        NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','completed')),
  price_pence         int         NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
  payment_mode        text        NOT NULL CHECK (payment_mode IN ('prepay','door','both')),
  cancellation_reason text,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS venue_class_sessions_venue_starts_idx ON public.venue_class_sessions (venue_id, starts_at);
CREATE INDEX IF NOT EXISTS venue_class_sessions_space_starts_idx ON public.venue_class_sessions (space_id, starts_at);
CREATE INDEX IF NOT EXISTS venue_class_sessions_type_idx         ON public.venue_class_sessions (class_type_id);
CREATE INDEX IF NOT EXISTS venue_class_sessions_series_idx        ON public.venue_class_sessions (series_id);

-- Writes only through the SECURITY DEFINER RPCs below; reads only through the
-- list/detail RPCs. No direct client access on any of the three tables.
ALTER TABLE public.venue_class_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_class_series   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_class_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_class_types    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_class_series   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_class_sessions FROM PUBLIC, anon, authenticated;

-- ── 5. venue_create_class_type ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_create_class_type(
  p_venue_token               text,
  p_name                      text,
  p_space_id                  uuid,
  p_duration_minutes          int,
  p_default_capacity          int,
  p_category                  text,
  p_cancellation_cutoff_hours int     DEFAULT 2,
  p_first_session_free        boolean DEFAULT false,
  p_description               text    DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_class_type(text,text,uuid,int,int,text,int,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_class_type(text,text,uuid,int,int,text,int,boolean,text) TO anon, authenticated;

-- ── 6. venue_update_class_type (jsonb patch) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_update_class_type(
  p_venue_token  text,
  p_class_type_id uuid,
  p_updates      jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
$fn$;
REVOKE ALL ON FUNCTION public.venue_update_class_type(text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_class_type(text,uuid,jsonb) TO anon, authenticated;

-- ── 7. venue_list_class_types ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_list_class_types(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_class_types(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_class_types(text) TO anon, authenticated;

-- ── 8. venue_schedule_class_session (one-off) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_schedule_class_session(
  p_venue_token   text,
  p_class_type_id uuid,
  p_instructor_id uuid,
  p_starts_at     timestamptz,
  p_price_pence   int,
  p_payment_mode  text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_ct public.venue_class_types; v_ends timestamptz; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ct FROM public.venue_class_types WHERE id = p_class_type_id;
  IF NOT FOUND OR v_ct.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'class_type_not_found' USING ERRCODE='P0001'; END IF;
  IF p_payment_mode NOT IN ('prepay','door','both') THEN RAISE EXCEPTION 'bad_payment_mode' USING ERRCODE='P0001'; END IF;
  IF p_starts_at IS NULL THEN RAISE EXCEPTION 'starts_at_required' USING ERRCODE='P0001'; END IF;
  IF COALESCE(p_price_pence, 0) < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_admins WHERE id = p_instructor_id AND venue_id = v_caller.venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'instructor_not_found' USING ERRCODE='P0001';
  END IF;

  v_ends := p_starts_at + (v_ct.duration_minutes * INTERVAL '1 minute');
  IF NOT public._space_is_available(v_ct.space_id, p_starts_at, v_ends) THEN
    RAISE EXCEPTION 'space_unavailable' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.venue_class_sessions
    (venue_id, class_type_id, series_id, instructor_id, space_id, starts_at, ends_at,
     capacity, status, price_pence, payment_mode)
  VALUES
    (v_caller.venue_id, p_class_type_id, NULL, p_instructor_id, v_ct.space_id, p_starts_at, v_ends,
     v_ct.default_capacity, 'scheduled', COALESCE(p_price_pence, 0), p_payment_mode)
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_session_scheduled', 'venue_class_session', v_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'class_type_id', p_class_type_id,
                             'starts_at', p_starts_at, 'instructor_id', p_instructor_id));

  RETURN jsonb_build_object('ok', true, 'session_id', v_id, 'ends_at', v_ends);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_schedule_class_session(text,uuid,uuid,timestamptz,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_schedule_class_session(text,uuid,uuid,timestamptz,int,text) TO anon, authenticated;

-- ── 9. venue_create_class_series (pre-generate sessions) ─────────────────────
-- Generates one session per matching weekday from series_start to the effective
-- end (series_end, or a bounded 180-day horizon when open-ended). Sessions whose
-- slot is already taken (per _space_is_available) are skipped, not failed — the
-- block is created and the conflict count is reported so the operator can see it.

CREATE OR REPLACE FUNCTION public.venue_create_class_series(
  p_venue_token   text,
  p_class_type_id uuid,
  p_instructor_id uuid,
  p_day_of_week   smallint,
  p_start_time    time,
  p_series_start  date,
  p_price_pence   int,
  p_payment_mode  text,
  p_series_end    date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller    record;
  v_ct        public.venue_class_types;
  v_series_id uuid;
  v_eff_end   date;
  v_cursor    date;
  v_starts    timestamptz;
  v_ends      timestamptz;
  v_created   int := 0;
  v_skipped   int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ct FROM public.venue_class_types WHERE id = p_class_type_id;
  IF NOT FOUND OR v_ct.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'class_type_not_found' USING ERRCODE='P0001'; END IF;
  IF p_payment_mode NOT IN ('prepay','door','both') THEN RAISE EXCEPTION 'bad_payment_mode' USING ERRCODE='P0001'; END IF;
  IF p_day_of_week NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE='P0001'; END IF;
  IF p_series_start IS NULL OR p_start_time IS NULL THEN RAISE EXCEPTION 'schedule_required' USING ERRCODE='P0001'; END IF;
  IF p_series_end IS NOT NULL AND p_series_end < p_series_start THEN RAISE EXCEPTION 'end_before_start' USING ERRCODE='P0001'; END IF;
  IF COALESCE(p_price_pence, 0) < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_admins WHERE id = p_instructor_id AND venue_id = v_caller.venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'instructor_not_found' USING ERRCODE='P0001';
  END IF;

  v_eff_end := COALESCE(p_series_end, p_series_start + INTERVAL '180 days');

  INSERT INTO public.venue_class_series
    (class_type_id, instructor_id, day_of_week, start_time, series_start, series_end, price_pence, payment_mode)
  VALUES
    (p_class_type_id, p_instructor_id, p_day_of_week, p_start_time, p_series_start, p_series_end,
     COALESCE(p_price_pence, 0), p_payment_mode)
  RETURNING id INTO v_series_id;

  -- first date on or after series_start matching the target weekday
  v_cursor := p_series_start + ((p_day_of_week - EXTRACT(DOW FROM p_series_start)::int + 7) % 7) * INTERVAL '1 day';

  WHILE v_cursor <= v_eff_end LOOP
    v_starts := (v_cursor + p_start_time)::timestamptz;
    v_ends   := v_starts + (v_ct.duration_minutes * INTERVAL '1 minute');
    IF public._space_is_available(v_ct.space_id, v_starts, v_ends) THEN
      INSERT INTO public.venue_class_sessions
        (venue_id, class_type_id, series_id, instructor_id, space_id, starts_at, ends_at,
         capacity, status, price_pence, payment_mode)
      VALUES
        (v_caller.venue_id, p_class_type_id, v_series_id, p_instructor_id, v_ct.space_id, v_starts, v_ends,
         v_ct.default_capacity, 'scheduled', COALESCE(p_price_pence, 0), p_payment_mode);
      v_created := v_created + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
    v_cursor := v_cursor + INTERVAL '7 days';
  END LOOP;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_series_created', 'venue_class_series', v_series_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'class_type_id', p_class_type_id,
                             'sessions_created', v_created, 'sessions_skipped', v_skipped));

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id,
                            'sessions_created', v_created, 'sessions_skipped', v_skipped);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_class_series(text,uuid,uuid,smallint,time,date,int,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_class_series(text,uuid,uuid,smallint,time,date,int,text,date) TO anon, authenticated;

-- ── 10. venue_cancel_class_session ───────────────────────────────────────────
-- Venue-side cancel: no cutoff applies. Flips the session to cancelled, then
-- (forward-guarded) VOID+REFUNDS every class charge for the session's bookings,
-- cancels those bookings, and queues a cancellation notification per member.

CREATE OR REPLACE FUNCTION public.venue_cancel_class_session(
  p_venue_token text,
  p_session_id  uuid,
  p_reason      text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_sess public.venue_class_sessions; v_refunded int := 0; v_notified int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'session_id', p_session_id);
  END IF;

  UPDATE public.venue_class_sessions SET status = 'cancelled', cancellation_reason = p_reason WHERE id = p_session_id;

  -- Forward-guarded refund + booking-cancel + notify cascade (Phase 3 table).
  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    EXECUTE format($q$
      UPDATE public.venue_charges c SET status = 'refunded'
       WHERE c.source_type = 'class' AND c.status <> 'refunded'
         AND c.source_id IN (SELECT b.id::text FROM public.venue_class_bookings b WHERE b.session_id = %L)
    $q$, p_session_id);
    GET DIAGNOSTICS v_refunded = ROW_COUNT;

    EXECUTE format($q$
      UPDATE public.venue_class_bookings b SET status = 'cancelled', cancelled_at = now()
       WHERE b.session_id = %L AND b.status IN ('confirmed','waitlist')
    $q$, p_session_id);
    GET DIAGNOSTICS v_notified = ROW_COUNT;

    EXECUTE format($q$
      INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
      SELECT %L, b.member_profile_id::text, 'class_cancelled', %L, mp.email, now(),
             jsonb_build_object('reason', %L)
        FROM public.venue_class_bookings b
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.session_id = %L AND b.status = 'cancelled'
    $q$, v_caller.venue_id, p_session_id::text, p_reason, p_session_id);
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_session_cancelled', 'venue_class_session', p_session_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason,
                             'refunded', v_refunded, 'notified', v_notified));

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'refunded', v_refunded, 'notified', v_notified);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_class_session(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_class_session(text,uuid,text) TO anon, authenticated;

-- ── 11. venue_cancel_class_series ────────────────────────────────────────────
-- Bulk-cancels remaining future scheduled sessions of a series; same per-session
-- refund + booking-cancel + notify cascade as the single-session cancel.

CREATE OR REPLACE FUNCTION public.venue_cancel_class_series(
  p_venue_token text,
  p_series_id   uuid,
  p_reason      text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_cancelled int := 0; v_refunded int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT ct.venue_id INTO v_venue_id
  FROM public.venue_class_series s
  JOIN public.venue_class_types ct ON ct.id = s.class_type_id
  WHERE s.id = p_series_id;
  IF v_venue_id IS NULL OR v_venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE='P0001'; END IF;

  -- Forward-guarded: refund + cancel bookings of the soon-to-be-cancelled sessions.
  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    EXECUTE format($q$
      UPDATE public.venue_charges c SET status = 'refunded'
       WHERE c.source_type = 'class' AND c.status <> 'refunded'
         AND c.source_id IN (
           SELECT b.id::text FROM public.venue_class_bookings b
           JOIN public.venue_class_sessions cs ON cs.id = b.session_id
           WHERE cs.series_id = %L AND cs.status = 'scheduled' AND cs.starts_at > now())
    $q$, p_series_id);
    GET DIAGNOSTICS v_refunded = ROW_COUNT;

    EXECUTE format($q$
      INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
      SELECT %L, b.member_profile_id::text, 'class_cancelled', cs.id::text, mp.email, now(),
             jsonb_build_object('reason', %L, 'series_id', %L)
        FROM public.venue_class_bookings b
        JOIN public.venue_class_sessions cs ON cs.id = b.session_id
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE cs.series_id = %L AND cs.status = 'scheduled' AND cs.starts_at > now()
         AND b.status IN ('confirmed','waitlist')
    $q$, v_caller.venue_id, p_reason, p_series_id, p_series_id);

    EXECUTE format($q$
      UPDATE public.venue_class_bookings b SET status = 'cancelled', cancelled_at = now()
       WHERE b.status IN ('confirmed','waitlist')
         AND b.session_id IN (
           SELECT cs.id FROM public.venue_class_sessions cs
           WHERE cs.series_id = %L AND cs.status = 'scheduled' AND cs.starts_at > now())
    $q$, p_series_id);
  END IF;

  UPDATE public.venue_class_sessions SET status = 'cancelled', cancellation_reason = p_reason
   WHERE series_id = p_series_id AND status = 'scheduled' AND starts_at > now();
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE public.venue_class_series SET is_active = false WHERE id = p_series_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_series_cancelled', 'venue_class_series', p_series_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason,
                             'sessions_cancelled', v_cancelled, 'refunded', v_refunded));

  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id,
                            'sessions_cancelled', v_cancelled, 'refunded', v_refunded);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_cancel_class_series(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_cancel_class_series(text,uuid,text) TO anon, authenticated;

-- ── 12. venue_reassign_class_instructor ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_reassign_class_instructor(
  p_venue_token     text,
  p_session_id      uuid,
  p_new_instructor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_sess public.venue_class_sessions;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' THEN RAISE EXCEPTION 'session_not_scheduled' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_admins WHERE id = p_new_instructor_id AND venue_id = v_caller.venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'instructor_not_found' USING ERRCODE='P0001';
  END IF;

  UPDATE public.venue_class_sessions SET instructor_id = p_new_instructor_id WHERE id = p_session_id;

  -- Forward-guarded: queue a reassignment notice to each booked member.
  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    EXECUTE format($q$
      INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for)
      SELECT %L, b.member_profile_id::text, 'class_instructor_changed', %L, mp.email, now()
        FROM public.venue_class_bookings b
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.session_id = %L AND b.status = 'confirmed'
    $q$, v_caller.venue_id, p_session_id::text, p_session_id);
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_instructor_reassigned', 'venue_class_session', p_session_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'from', v_sess.instructor_id, 'to', p_new_instructor_id));

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'instructor_id', p_new_instructor_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_reassign_class_instructor(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_reassign_class_instructor(text,uuid,uuid) TO anon, authenticated;

-- ── 13. venue_list_class_sessions ────────────────────────────────────────────
-- Sessions in an optional window with fill data. booked_count / waitlist_count
-- are forward-guarded (0 until Phase 3 bookings land) via dynamic SQL.

CREATE OR REPLACE FUNCTION public.venue_list_class_sessions(
  p_venue_token text,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller     record;
  v_result     jsonb;
  v_has_bk     boolean := to_regclass('public.venue_class_bookings') IS NOT NULL;
  v_booked_sql text;
  v_wait_sql   text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  v_booked_sql := CASE WHEN v_has_bk THEN
    '(SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.status = ''confirmed'')'
    ELSE '0' END;
  v_wait_sql := CASE WHEN v_has_bk THEN
    '(SELECT count(*) FROM public.venue_class_bookings b WHERE b.session_id = cs.id AND b.status = ''waitlist'')'
    ELSE '0' END;

  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.starts_at), '[]'::jsonb) FROM (
      SELECT cs.id, cs.venue_id, cs.class_type_id, ct.name AS class_name, ct.category,
             cs.series_id, cs.space_id, sp.name AS space_name,
             cs.instructor_id, va.email AS instructor_email,
             cs.starts_at, cs.ends_at, cs.capacity, cs.status, cs.price_pence, cs.payment_mode,
             cs.cancellation_reason, %s::int AS booked_count, %s::int AS waitlist_count
      FROM public.venue_class_sessions cs
      JOIN public.venue_class_types ct ON ct.id = cs.class_type_id
      JOIN public.venue_spaces sp ON sp.id = cs.space_id
      LEFT JOIN public.venue_admins va ON va.id = cs.instructor_id
      WHERE cs.venue_id = %L
        AND (%L::timestamptz IS NULL OR cs.starts_at >= %L::timestamptz)
        AND (%L::timestamptz IS NULL OR cs.starts_at <= %L::timestamptz)
    ) x
  $q$, v_booked_sql, v_wait_sql, v_caller.venue_id, p_from, p_from, p_to, p_to)
  INTO v_result;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_class_sessions(text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_class_sessions(text,timestamptz,timestamptz) TO anon, authenticated;

-- ── 14. venue_get_class_session_detail ───────────────────────────────────────
-- Session core + attendee list (attendees forward-guarded — empty until Phase 3).

CREATE OR REPLACE FUNCTION public.venue_get_class_session_detail(
  p_venue_token text,
  p_session_id  uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_sess record; v_attendees jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT cs.id, cs.venue_id, cs.class_type_id, ct.name AS class_name, ct.category,
         cs.series_id, cs.space_id, sp.name AS space_name, cs.instructor_id, va.email AS instructor_email,
         cs.starts_at, cs.ends_at, cs.capacity, cs.status, cs.price_pence, cs.payment_mode,
         cs.cancellation_reason, cs.completed_at
    INTO v_sess
  FROM public.venue_class_sessions cs
  JOIN public.venue_class_types ct ON ct.id = cs.class_type_id
  JOIN public.venue_spaces sp ON sp.id = cs.space_id
  LEFT JOIN public.venue_admins va ON va.id = cs.instructor_id
  WHERE cs.id = p_session_id AND cs.venue_id = v_caller.venue_id;
  IF v_sess.id IS NULL THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;

  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    EXECUTE format($q$
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'booking_id', b.id, 'member_profile_id', b.member_profile_id,
               'member_name', btrim(coalesce(mp.first_name,'') || ' ' || coalesce(mp.last_name,'')),
               'status', b.status, 'payment_status', b.payment_status,
               'waitlist_position', b.waitlist_position) ORDER BY b.status, b.booked_at), '[]'::jsonb)
        FROM public.venue_class_bookings b
        JOIN public.member_profiles mp ON mp.id = b.member_profile_id
       WHERE b.session_id = %L
    $q$, p_session_id) INTO v_attendees;
  END IF;

  RETURN to_jsonb(v_sess) || jsonb_build_object('attendees', v_attendees);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_get_class_session_detail(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_get_class_session_detail(text,uuid) TO anon, authenticated;

-- ── 15. venue_mark_class_completed ───────────────────────────────────────────
-- Marks the session completed. Forward-guarded no-show capture: every booking
-- still 'confirmed' that was NOT checked in (no checked_in_at — Phase 6) flips to
-- 'no_show' and the member's no_show_count is bumped. Both the bookings table and
-- the no_show_count column land in Phase 3; the checked_in_at column lands in
-- Phase 6 — all probed at runtime so this RPC needs no later edit.

CREATE OR REPLACE FUNCTION public.venue_mark_class_completed(
  p_venue_token text,
  p_session_id  uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller    record;
  v_sess      public.venue_class_sessions;
  v_no_show   int := 0;
  v_has_chkin boolean;
  v_has_count boolean;
  v_flip_sql  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'cancelled' THEN RAISE EXCEPTION 'session_cancelled' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'session_id', p_session_id);
  END IF;

  UPDATE public.venue_class_sessions SET status = 'completed', completed_at = now() WHERE id = p_session_id;

  IF to_regclass('public.venue_class_bookings') IS NOT NULL THEN
    v_has_chkin := EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='venue_class_bookings' AND column_name='checked_in_at');
    v_has_count := EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='member_profiles' AND column_name='no_show_count');

    -- flip un-checked-in confirmed bookings → no_show, returning affected members
    v_flip_sql := 'UPDATE public.venue_class_bookings b SET status=''no_show'''
               || ' WHERE b.session_id = $1 AND b.status = ''confirmed'''
               || CASE WHEN v_has_chkin THEN ' AND b.checked_in_at IS NULL' ELSE '' END
               || ' RETURNING b.member_profile_id';

    IF v_has_count THEN
      EXECUTE 'WITH flipped AS (' || v_flip_sql || '), bumped AS ('
           || ' UPDATE public.member_profiles mp SET no_show_count = no_show_count + 1'
           || ' FROM flipped f WHERE mp.id = f.member_profile_id RETURNING 1)'
           || ' SELECT count(*) FROM flipped'
        INTO v_no_show USING p_session_id;
    ELSE
      EXECUTE 'WITH flipped AS (' || v_flip_sql || ') SELECT count(*) FROM flipped'
        INTO v_no_show USING p_session_id;
    END IF;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_session_completed', 'venue_class_session', p_session_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'no_show_count', v_no_show));

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'no_show_count', v_no_show);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_mark_class_completed(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_mark_class_completed(text,uuid) TO anon, authenticated;

-- Refresh PostgREST's function-signature cache.
SELECT pg_notify('pgrst', 'reload schema');
