-- Migration 399 — Modular feature flags (Venue OS nav, Phase 1: flag foundation).
--
-- Extends the mig-351 get_team_feature_flags pattern (a lightweight reader RPC over
-- a boolean flag store, kept separate from the load-bearing state RPCs) to a TWO-table
-- model that resolves the ownership split locked in DECISIONS s178:
--
--   venue_features (per VENUE)  — Bookings / Spaces / Room hire / Equipment.
--                                 Facility-owned: belong to the physical site.
--   club_features  (per CLUB)   — Memberships / Competition / Coaching / Tournaments
--                                 / Public web. Org-owned: FOLLOW the club to every
--                                 venue it operates from (via club_venues).
--
-- The venue rail = (this venue's facility features) ∪ (the features of every club
-- operating at this venue). get_venue_feature_flags() computes that union server-side.
--
-- DEFAULT-ALL-ON (non-negotiable, zero regression on ship day): every flag column
-- DEFAULTs true AND a MISSING row reads as on (COALESCE(...) / bool_or over zero rows
-- → true). So existing venues/clubs need ZERO backfill — turning a feature OFF is the
-- only thing that ever writes a row (Phase 2 operator UI). An unknown feature name is
-- treated as ON (fail-open) so a typo can never silently hide a working surface.
--
-- This phase ships the foundation + the 3-layer gate (nav + route + server). The
-- server layer = the two _feature_enabled helpers below, called at the top of every
-- gated write RPC (see the guarded CREATE OR REPLACE blocks later in this migration).
-- While every flag is on, those guards are inert — they reject nothing until a flag
-- is flipped off, so this migration is behaviourally a no-op on apply.
--
-- Consumers (Hard Rule #14): apps/venue App.jsx + Dashboard rail/route gates
-- (get_venue_feature_flags / getVenueFeatureFlags); every gated venue/club write RPC
-- (the _feature_enabled guards). Phase 2 adds the operator toggle UI + dependency graph.

-- ── 1. Flag stores ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_features (
  venue_id   text PRIMARY KEY REFERENCES public.venues(id) ON DELETE CASCADE,
  bookings   boolean NOT NULL DEFAULT true,
  spaces     boolean NOT NULL DEFAULT true,
  room_hire  boolean NOT NULL DEFAULT true,
  equipment  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.club_features (
  club_id     text PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  memberships boolean NOT NULL DEFAULT true,
  competition boolean NOT NULL DEFAULT true,   -- League Mode + fixtures/standings
  coaching    boolean NOT NULL DEFAULT true,   -- club sessions / classes / trainers (PT)
  tournaments boolean NOT NULL DEFAULT true,   -- Event OS / cups
  public_web  boolean NOT NULL DEFAULT true,   -- reserved (Epic B; no rail item yet)
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS on, NO client policies: these are written only by SECURITY DEFINER operator RPCs
-- (Phase 2) and read only via the SECURITY DEFINER reader/guards below.
ALTER TABLE public.venue_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_features  ENABLE ROW LEVEL SECURITY;

-- ── 2. Server-side guard helpers (layer 3 of the 3-layer gate) ───────────────
-- Both fail OPEN: missing row or unknown feature → true. A gated write RPC calls
--   IF NOT public._venue_feature_enabled(v_venue_id, 'bookings') THEN
--     RAISE EXCEPTION 'feature_disabled' USING ERRCODE='P0001'; END IF;
CREATE OR REPLACE FUNCTION public._venue_feature_enabled(p_venue_id text, p_feature text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT CASE p_feature
              WHEN 'bookings'  THEN vf.bookings
              WHEN 'spaces'    THEN vf.spaces
              WHEN 'room_hire' THEN vf.room_hire
              WHEN 'equipment' THEN vf.equipment
            END
     FROM public.venue_features vf
     WHERE vf.venue_id = p_venue_id),
    true);
$function$;

CREATE OR REPLACE FUNCTION public._club_feature_enabled(p_club_id text, p_feature text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT CASE p_feature
              WHEN 'memberships' THEN cf.memberships
              WHEN 'competition' THEN cf.competition
              WHEN 'coaching'    THEN cf.coaching
              WHEN 'tournaments' THEN cf.tournaments
              WHEN 'public_web'  THEN cf.public_web
            END
     FROM public.club_features cf
     WHERE cf.club_id = p_club_id),
    true);
$function$;

-- Union helper: is a CLUB feature on for ANY club operating at this venue? Used by
-- venue-token writes for club-owned features (memberships/coaching/competition/
-- tournaments) that resolve only a venue_id today (pre Phase-2 membership-scope
-- refactor). Matches the rail's union semantics. Fails OPEN (no clubs/rows → true).
CREATE OR REPLACE FUNCTION public._venue_club_feature_enabled(p_venue_id text, p_feature text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    bool_or(public._club_feature_enabled(cv.club_id, p_feature)),
    true)
  FROM public.club_venues cv
  WHERE cv.venue_id = p_venue_id;
$function$;

REVOKE ALL     ON FUNCTION public._venue_feature_enabled(text, text)      FROM public;
REVOKE ALL     ON FUNCTION public._club_feature_enabled(text, text)       FROM public;
REVOKE ALL     ON FUNCTION public._venue_club_feature_enabled(text, text) FROM public;
-- Also strip Supabase's default anon/authenticated EXECUTE — these helpers are
-- internal (called only from other SECURITY DEFINER funcs, which run as owner, so
-- the guarded RPCs are unaffected). Clients must not call them directly.
REVOKE EXECUTE ON FUNCTION public._venue_feature_enabled(text, text)      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._club_feature_enabled(text, text)       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._venue_club_feature_enabled(text, text) FROM anon, authenticated;
-- Internal helpers only — invoked from other SECURITY DEFINER functions, never the client.

-- ── 3. Reader RPC: the merged flag set for a venue (nav + route layers) ───────
-- Mirrors get_team_feature_flags. Resolves venue_id from the same credential every
-- venue RPC uses (resolve_venue_caller: backdoor token OR staff venue_id). Returns
-- venue flags for THIS venue ∪ the OR of each club feature across every club operating
-- at this venue (club_venues). Club-less or row-less → all true (default-all-on).
CREATE OR REPLACE FUNCTION public.get_venue_feature_flags(p_credential text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_vf       record;
  v_cf       record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_credential);
  v_venue_id := v_caller.venue_id;

  -- No concrete venue (e.g. platform admin) → everything on; the rail never hides
  -- on an unresolved caller.
  IF v_venue_id IS NULL THEN
    RETURN jsonb_build_object(
      'bookings', true, 'spaces', true, 'room_hire', true, 'equipment', true,
      'memberships', true, 'competition', true, 'coaching', true,
      'tournaments', true, 'public_web', true
    );
  END IF;

  -- Venue (facility) flags — missing row → all true.
  SELECT COALESCE(vf.bookings,  true) AS bookings,
         COALESCE(vf.spaces,    true) AS spaces,
         COALESCE(vf.room_hire, true) AS room_hire,
         COALESCE(vf.equipment, true) AS equipment
    INTO v_vf
  FROM (SELECT v_venue_id AS venue_id) base
  LEFT JOIN public.venue_features vf ON vf.venue_id = base.venue_id;

  -- Club (org) flags — OR across every club operating at this venue. No clubs / no
  -- rows → all true (bool_or over zero true-coalesced rows is NULL → COALESCE true).
  SELECT COALESCE(bool_or(COALESCE(cf.memberships, true)), true) AS memberships,
         COALESCE(bool_or(COALESCE(cf.competition, true)), true) AS competition,
         COALESCE(bool_or(COALESCE(cf.coaching,    true)), true) AS coaching,
         COALESCE(bool_or(COALESCE(cf.tournaments, true)), true) AS tournaments,
         COALESCE(bool_or(COALESCE(cf.public_web,  true)), true) AS public_web
    INTO v_cf
  FROM public.club_venues cv
  LEFT JOIN public.club_features cf ON cf.club_id = cv.club_id
  WHERE cv.venue_id = v_venue_id;

  RETURN jsonb_build_object(
    'bookings',    v_vf.bookings,
    'spaces',      v_vf.spaces,
    'room_hire',   v_vf.room_hire,
    'equipment',   v_vf.equipment,
    'memberships', COALESCE(v_cf.memberships, true),
    'competition', COALESCE(v_cf.competition, true),
    'coaching',    COALESCE(v_cf.coaching,    true),
    'tournaments', COALESCE(v_cf.tournaments, true),
    'public_web',  COALESCE(v_cf.public_web,  true)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_venue_feature_flags(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_venue_feature_flags(text) TO anon, authenticated;

-- ── 4. Gated write-RPC guards (layer 3) — appended below once enumerated ──────
-- (guarded CREATE OR REPLACE blocks land here in the same migration)

-- ════════════════════════════════════════════════════════════════════════════
-- SERVER-LAYER GUARDS (layer 3 of the 3-layer gate)
-- One guard block per gated write RPC: rejects with 'feature_disabled' when the
-- owning feature is off, placed immediately after the venue_id/club_id is
-- resolved and BEFORE any write. 74 functions across the 8 features. Inert while
-- every flag is on (default). Verified: only the guard changed in each body
-- (line-level baseline diff, REMOVED=0); flag-off rejects + flag-on passes
-- through (EV, self-rolled-back, leak-clean). Customer CRUD intentionally NOT
-- gated (reachable from the always-on Customers screen).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── bookings ───────────────────────────────────────────────────────────────────
-- 399: feature-flag guards for BOOKINGS write RPCs — gate on venue feature 'bookings' via public._venue_feature_enabled. DRAFT (not applied).

CREATE OR REPLACE FUNCTION public.venue_create_booking(p_venue_token text, p_playing_area_id uuid, p_booking_date date, p_kickoff_time time without time zone, p_slot_minutes integer DEFAULT NULL::integer, p_team_id text DEFAULT NULL::text, p_booked_by_name text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_slot int;
  v_start timestamptz;
  v_booking_id uuid := gen_random_uuid();
  v_email text := NULLIF(btrim(p_contact_email),'');
  v_phone text := NULLIF(btrim(p_contact_phone),'');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'bookings') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_playing_area_id IS NULL OR p_booking_date IS NULL OR p_kickoff_time IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_team_id IS NULL AND NULLIF(trim(COALESCE(p_booked_by_name,'')),'') IS NULL THEN
    RAISE EXCEPTION 'booker_required' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._validate_booking_contact(v_email, v_phone);

  IF NOT EXISTS (SELECT 1 FROM playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  v_slot := COALESCE(p_slot_minutes, 60);
  v_start := (p_booking_date + p_kickoff_time) AT TIME ZONE 'Europe/London';

  INSERT INTO pitch_bookings (id, team_id, booked_by_name, contact_email, contact_phone,
    venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
  VALUES (v_booking_id, p_team_id, NULLIF(trim(p_booked_by_name),''), v_email, v_phone,
    v_venue_id, p_playing_area_id, p_booking_date, p_kickoff_time, v_slot, 'adhoc', 'confirmed');

  BEGIN
    INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 3, true);
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(p_team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'pitch_booking', v_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'playing_area_id', p_playing_area_id, 'booking_date', p_booking_date,
                       'kickoff_time', p_kickoff_time, 'slot_minutes', v_slot, 'kind', 'adhoc', 'walk_in', (p_team_id IS NULL),
                       'booked_by_name', NULLIF(trim(p_booked_by_name),''), 'contact_email', v_email, 'contact_phone', v_phone));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF p_team_id IS NOT NULL THEN PERFORM public.notify_team_change(p_team_id, 'booking_confirmed'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', 'confirmed', 'kind', 'adhoc');
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_create_booking_series(p_venue_token text, p_playing_area_id uuid, p_kickoff_time time without time zone, p_start_date date, p_weeks integer, p_team_id text, p_slot_minutes integer DEFAULT NULL::integer, p_contact_email text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_slot int;
  v_dow smallint;
  v_series_id uuid := gen_random_uuid();
  v_i int;
  v_date date;
  v_start timestamptz;
  v_booking_id uuid;
  v_email text := NULLIF(btrim(p_contact_email),'');
  v_phone text := NULLIF(btrim(p_contact_phone),'');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'bookings') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_playing_area_id IS NULL OR p_kickoff_time IS NULL OR p_start_date IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'series_team_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_weeks IS NULL OR p_weeks < 1 OR p_weeks > 52 THEN
    RAISE EXCEPTION 'weeks_out_of_range' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._validate_booking_contact(v_email, v_phone);

  IF NOT EXISTS (SELECT 1 FROM playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  v_slot := COALESCE(p_slot_minutes, 60);
  v_dow  := EXTRACT(DOW FROM p_start_date)::smallint;

  INSERT INTO booking_series (id, team_id, venue_id, playing_area_id, day_of_week, kickoff_time, slot_minutes, status, ends_on)
  VALUES (v_series_id, p_team_id, v_venue_id, p_playing_area_id, v_dow, p_kickoff_time, v_slot, 'active', p_start_date + (p_weeks - 1) * 7);

  BEGIN
    FOR v_i IN 0 .. (p_weeks - 1) LOOP
      v_date := p_start_date + v_i * 7;
      v_start := (v_date + p_kickoff_time) AT TIME ZONE 'Europe/London';
      v_booking_id := gen_random_uuid();
      INSERT INTO pitch_bookings (id, team_id, contact_email, contact_phone, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status, series_id)
      VALUES (v_booking_id, p_team_id, v_email, v_phone, v_venue_id, p_playing_area_id, v_date, p_kickoff_time, v_slot, 'block', 'confirmed', v_series_id);
      INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
      VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 2, true);
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001', DETAIL = v_date::text;
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (p_team_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'booking_series', v_series_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'playing_area_id', p_playing_area_id, 'day_of_week', v_dow,
                       'kickoff_time', p_kickoff_time, 'slot_minutes', v_slot, 'weeks', p_weeks, 'start_date', p_start_date,
                       'kind', 'block', 'contact_email', v_email, 'contact_phone', v_phone));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  PERFORM public.notify_team_change(p_team_id, 'booking_confirmed');

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'weeks', p_weeks, 'status', 'confirmed', 'kind', 'block');
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_confirm_booking(p_venue_token text, p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_bk record; v_fee int; v_base int; v_cust uuid; v_pct int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'bookings') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_bk FROM pitch_bookings WHERE id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.venue_id <> v_venue_id THEN RAISE EXCEPTION 'booking_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.status <> 'requested' THEN RAISE EXCEPTION 'booking_not_pending' USING ERRCODE = 'P0001', DETAIL = v_bk.status; END IF;
  UPDATE pitch_bookings SET status = 'confirmed' WHERE id = p_booking_id;
  SELECT COALESCE(NULLIF(v_bk.amount_pence, 0), pa.default_fee_pence) INTO v_fee FROM playing_areas pa WHERE pa.id = v_bk.playing_area_id;
  SELECT d.customer_id, d.pct INTO v_cust, v_pct FROM public._booking_member_discount(v_venue_id, v_bk.customer_id, v_bk.contact_email) d;
  IF v_cust IS NOT NULL AND v_bk.customer_id IS NULL THEN UPDATE pitch_bookings SET customer_id = v_cust WHERE id = p_booking_id; END IF;
  UPDATE pitch_bookings SET member_discount_pct = NULLIF(COALESCE(v_pct,0), 0) WHERE id = p_booking_id;
  v_base := v_fee;
  IF v_fee IS NOT NULL AND v_fee > 0 AND COALESCE(v_pct,0) > 0 THEN v_fee := v_fee - round(v_fee * v_pct / 100.0)::int; END IF;
  IF v_fee IS NOT NULL AND v_fee > 0 THEN
    INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_venue_id, 'booking', p_booking_id::text, v_bk.team_id, NULL, v_fee, 'unpaid', v_bk.booking_date)
    ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;
  END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'pitch_booking', p_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id, 'base_fee_pence', v_base, 'member_discount_pct', COALESCE(v_pct,0), 'member_customer_id', v_cust, 'charge_fee_pence', v_fee));
  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_confirmed'); END IF;
  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'confirmed', 'member_discount_pct', COALESCE(v_pct,0), 'charge_fee_pence', v_fee);
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_confirm_booking_series(p_venue_token text, p_series_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_series record; v_bk record; v_fee int; v_base int; v_cust uuid; v_pct int; v_confirmed int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'bookings') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_series FROM booking_series WHERE id = p_series_id;
  IF v_series.id IS NULL THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_series.venue_id <> v_venue_id THEN RAISE EXCEPTION 'booking_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  FOR v_bk IN SELECT * FROM pitch_bookings WHERE series_id = p_series_id AND venue_id = v_venue_id AND status = 'requested' ORDER BY booking_date
  LOOP
    UPDATE pitch_bookings SET status = 'confirmed' WHERE id = v_bk.id;
    SELECT COALESCE(NULLIF(v_bk.amount_pence, 0), pa.default_fee_pence) INTO v_fee FROM playing_areas pa WHERE pa.id = v_bk.playing_area_id;
    SELECT d.customer_id, d.pct INTO v_cust, v_pct FROM public._booking_member_discount(v_venue_id, v_bk.customer_id, v_bk.contact_email) d;
    IF v_cust IS NOT NULL AND v_bk.customer_id IS NULL THEN UPDATE pitch_bookings SET customer_id = v_cust WHERE id = v_bk.id; END IF;
    UPDATE pitch_bookings SET member_discount_pct = NULLIF(COALESCE(v_pct,0), 0) WHERE id = v_bk.id;
    v_base := v_fee;
    IF v_fee IS NOT NULL AND v_fee > 0 AND COALESCE(v_pct,0) > 0 THEN v_fee := v_fee - round(v_fee * v_pct / 100.0)::int; END IF;
    IF v_fee IS NOT NULL AND v_fee > 0 THEN
      INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
      VALUES (v_venue_id, 'booking', v_bk.id::text, v_bk.team_id, NULL, v_fee, 'unpaid', v_bk.booking_date)
      ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING;
    END IF;
    v_confirmed := v_confirmed + 1;
  END LOOP;
  IF v_confirmed = 0 THEN RAISE EXCEPTION 'booking_not_pending' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_series.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_confirmed', 'booking_series', p_series_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'series_id', p_series_id, 'confirmed_count', v_confirmed));
  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF v_series.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_series.team_id, 'booking_confirmed'); END IF;
  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id, 'confirmed_count', v_confirmed, 'status', 'confirmed');
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_decline_booking(p_venue_token text, p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_bk record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'bookings') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_bk FROM pitch_bookings WHERE id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.venue_id <> v_venue_id THEN RAISE EXCEPTION 'booking_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_bk.status <> 'requested' THEN RAISE EXCEPTION 'booking_not_pending' USING ERRCODE = 'P0001', DETAIL = v_bk.status; END IF;

  UPDATE pitch_bookings SET status = 'declined' WHERE id = p_booking_id;
  UPDATE pitch_occupancy SET active = false WHERE source_kind = 'booking' AND source_id = p_booking_id::text;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'booking_declined', 'pitch_booking', p_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_declined');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_declined'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'declined');
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_venue_token text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_decision text DEFAULT NULL::text, p_within_policy boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bk record;
  v_caller record;
  v_uid uuid := auth.uid();
  v_actor_type text;
  v_actor_ident text;
  v_charge record;
  v_refund_pence int := 0;
  v_charged_pence int := 0;
  v_decision text := lower(coalesce(p_decision, ''));
BEGIN
  SELECT * INTO v_bk FROM pitch_bookings WHERE id = p_booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'P0001'; END IF;

  IF p_venue_token IS NOT NULL THEN
    SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
    IF v_caller IS NULL OR v_caller.venue_id IS NULL OR v_caller.venue_id <> v_bk.venue_id THEN
      RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
    END IF;
    v_actor_type := v_caller.actor_type; v_actor_ident := v_caller.actor_ident;
  ELSE
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
    IF v_bk.team_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = v_bk.team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0001';
    END IF;
    v_actor_type := 'team_admin'; v_actor_ident := 'user_id:' || v_uid::text;
  END IF;

  IF NOT public._venue_feature_enabled(v_bk.venue_id, 'bookings') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_bk.status NOT IN ('requested','confirmed') THEN
    RAISE EXCEPTION 'booking_not_cancellable' USING ERRCODE = 'P0001', DETAIL = v_bk.status;
  END IF;

  UPDATE pitch_bookings SET status = 'cancelled' WHERE id = p_booking_id;
  UPDATE pitch_occupancy SET active = false WHERE source_kind = 'booking' AND source_id = p_booking_id::text;

  SELECT * INTO v_charge FROM venue_charges
   WHERE source_type = 'booking' AND source_id = p_booking_id::text AND status <> 'refunded'
   ORDER BY created_at LIMIT 1;
  IF v_charge.id IS NOT NULL THEN
    IF v_decision = 'full' THEN
      UPDATE venue_charges SET status = 'refunded' WHERE id = v_charge.id;
      v_refund_pence := v_charge.amount_due_pence; v_charged_pence := 0;
    ELSIF v_decision = 'partial' THEN
      v_charged_pence := v_charge.amount_due_pence / 2;
      v_refund_pence := v_charge.amount_due_pence - v_charged_pence;
      UPDATE venue_charges SET amount_due_pence = v_charged_pence WHERE id = v_charge.id;
      PERFORM public._recompute_charge_status(v_charge.id);
    ELSE
      v_charged_pence := v_charge.amount_due_pence; v_refund_pence := 0;
    END IF;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_bk.team_id, v_bk.venue_id), v_uid, v_actor_type, v_actor_ident, 'booking_cancelled', 'pitch_booking', p_booking_id::text,
    jsonb_build_object(
      'venue_id', v_bk.venue_id, 'kind', v_bk.kind, 'series_id', v_bk.series_id,
      'by', CASE WHEN p_venue_token IS NOT NULL THEN 'venue' ELSE 'team' END,
      'reason', p_reason, 'note', p_note,
      'decision', NULLIF(v_decision, ''), 'within_policy', p_within_policy,
      'refund_pence', v_refund_pence, 'charged_pence', v_charged_pence,
      'booking_date', v_bk.booking_date, 'kickoff_time', v_bk.kickoff_time,
      'playing_area_id', v_bk.playing_area_id, 'team_id', v_bk.team_id,
      'booked_by_name', v_bk.booked_by_name));

  PERFORM public.notify_venue_change(v_bk.venue_id, 'booking_cancelled');
  IF v_bk.team_id IS NOT NULL THEN PERFORM public.notify_team_change(v_bk.team_id, 'booking_cancelled'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'cancelled',
                            'refund_pence', v_refund_pence, 'charged_pence', v_charged_pence);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking_series(p_series_id uuid, p_venue_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_series record;
  v_caller record;
  v_uid uuid := auth.uid();
  v_actor_type text;
  v_actor_ident text;
  v_cancelled int;
BEGIN
  SELECT * INTO v_series FROM booking_series WHERE id = p_series_id;
  IF v_series.id IS NULL THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0001'; END IF;

  IF p_venue_token IS NOT NULL THEN
    SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
    IF v_caller IS NULL OR v_caller.venue_id IS NULL OR v_caller.venue_id <> v_series.venue_id THEN
      RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
    END IF;
    v_actor_type := v_caller.actor_type; v_actor_ident := v_caller.actor_ident;
  ELSE
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
    IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = v_series.team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0001';
    END IF;
    v_actor_type := 'team_admin'; v_actor_ident := 'user_id:' || v_uid::text;
  END IF;

  IF NOT public._venue_feature_enabled(v_series.venue_id, 'bookings') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  -- free occupancy for the series' still-live bookings, then cancel them + the series
  UPDATE pitch_occupancy SET active = false
   WHERE source_kind = 'booking'
     AND source_id IN (SELECT id::text FROM pitch_bookings WHERE series_id = p_series_id AND status IN ('requested','confirmed'));

  UPDATE pitch_bookings SET status = 'cancelled'
   WHERE series_id = p_series_id AND status IN ('requested','confirmed');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE booking_series SET status = 'cancelled' WHERE id = p_series_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_series.team_id, v_uid, v_actor_type, v_actor_ident, 'booking_cancelled', 'booking_series', p_series_id::text,
    jsonb_build_object('venue_id', v_series.venue_id, 'cancelled_count', v_cancelled,
                       'by', CASE WHEN p_venue_token IS NOT NULL THEN 'venue' ELSE 'team' END));

  PERFORM public.notify_venue_change(v_series.venue_id, 'booking_cancelled');
  PERFORM public.notify_team_change(v_series.team_id, 'booking_cancelled');

  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id, 'cancelled_count', v_cancelled, 'status', 'cancelled');
END;
$function$;

-- ─── spaces ───────────────────────────────────────────────────────────────────
-- 399_guards_spaces.sql
-- Feature-flag guards for the SPACES feature's write RPCs.
-- Gates both write RPCs on the VENUE feature 'spaces' via
-- public._venue_feature_enabled(v_caller.venue_id, 'spaces').
--
-- DRAFT — guard-only change. Each function body below is byte-identical to the
-- live definition EXCEPT for the single inserted guard block, placed immediately
-- after the resolve_venue_caller NULL-check RAISE (venue_id resolved + valid) and
-- BEFORE any write. Signature / RETURNS / volatility / SECURITY DEFINER /
-- SET search_path / LANGUAGE / $function$ tags preserved verbatim. GRANTs untouched.

CREATE OR REPLACE FUNCTION public.venue_create_space(p_venue_token text, p_name text, p_capacity integer, p_space_type text, p_description text DEFAULT NULL::text, p_is_enquiry_only boolean DEFAULT false, p_enquiry_contact_name text DEFAULT NULL::text, p_enquiry_contact_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_id     uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_feature_enabled(v_caller.venue_id, 'spaces') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
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
$function$;

CREATE OR REPLACE FUNCTION public.venue_update_space(p_venue_token text, p_space_id uuid, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_space  public.venue_spaces;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_feature_enabled(v_caller.venue_id, 'spaces') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
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
$function$;

-- ─── equipment ───────────────────────────────────────────────────────────────────
-- 399_guards_equipment.sql
-- DRAFT — feature-flag guards for the EQUIPMENT feature's write RPCs.
-- Each function below is byte-identical to its live definition EXCEPT for a single
-- inserted guard block, placed immediately after the venue_id is resolved/validated
-- (right after `v_venue_id := v_caller.venue_id;`, following the invalid_venue_token
-- NULL-check) and BEFORE any write:
--
--   IF NOT public._venue_feature_enabled(v_venue_id, 'equipment') THEN
--     RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
--   END IF;
--
-- Signature / RETURNS / volatility / SECURITY DEFINER / SET search_path / LANGUAGE
-- all preserved verbatim. GRANTs untouched (no change). NOT YET APPLIED.

-- ---------------------------------------------------------------------------
-- 1. venue_upsert_equipment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_upsert_equipment(p_venue_token text, p_name text, p_category text, p_quantity integer, p_id uuid DEFAULT NULL::uuid, p_default_fee_pence integer DEFAULT 0, p_deposit_pence integer DEFAULT 0, p_hire_unit text DEFAULT 'per_session'::text, p_purchase_price_pence integer DEFAULT NULL::integer, p_acquired_on date DEFAULT NULL::date, p_condition text DEFAULT 'good'::text, p_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_existing record; v_row record; v_is_new boolean;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'equipment') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001'; END IF;
  IF p_category NOT IN ('apparel','balls','goals_targets','nets','training_aids','tech_av','safety') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'P0001', DETAIL = p_category; END IF;
  IF p_hire_unit NOT IN ('per_hour','per_session','per_day') THEN
    RAISE EXCEPTION 'invalid_hire_unit' USING ERRCODE = 'P0001', DETAIL = p_hire_unit; END IF;
  IF p_condition NOT IN ('new','good','worn','damaged','retired') THEN
    RAISE EXCEPTION 'invalid_condition' USING ERRCODE = 'P0001', DETAIL = p_condition; END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(p_default_fee_pence,0) < 0 OR COALESCE(p_deposit_pence,0) < 0
     OR COALESCE(p_purchase_price_pence,0) < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001'; END IF;

  v_is_new := p_id IS NULL;

  IF v_is_new THEN
    INSERT INTO equipment (venue_id, name, category, quantity, default_fee_pence, deposit_pence,
                           hire_unit, purchase_price_pence, acquired_on, condition, active)
    VALUES (v_venue_id, trim(p_name), p_category, p_quantity, COALESCE(p_default_fee_pence,0),
            COALESCE(p_deposit_pence,0), p_hire_unit, p_purchase_price_pence, p_acquired_on,
            p_condition, COALESCE(p_active,true))
    RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_existing FROM equipment WHERE id = p_id;
    IF v_existing.id IS NULL THEN RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = 'P0001'; END IF;
    IF v_existing.venue_id <> v_venue_id THEN RAISE EXCEPTION 'equipment_not_in_venue' USING ERRCODE = 'P0001'; END IF;
    UPDATE equipment SET
      name = trim(p_name), category = p_category, quantity = p_quantity,
      default_fee_pence = COALESCE(p_default_fee_pence,0), deposit_pence = COALESCE(p_deposit_pence,0),
      hire_unit = p_hire_unit, purchase_price_pence = p_purchase_price_pence,
      acquired_on = p_acquired_on, condition = p_condition, active = COALESCE(p_active,true),
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          CASE WHEN v_is_new THEN 'equipment_created' ELSE 'equipment_updated' END,
          'equipment', v_row.id::text,
          jsonb_build_object('venue_id', v_venue_id, 'name', v_row.name, 'category', v_row.category,
                             'quantity', v_row.quantity, 'active', v_row.active));

  RETURN jsonb_build_object('ok', true, 'is_new', v_is_new,
    'equipment', jsonb_build_object(
      'id', v_row.id, 'name', v_row.name, 'category', v_row.category, 'quantity', v_row.quantity,
      'default_fee_pence', v_row.default_fee_pence, 'deposit_pence', v_row.deposit_pence,
      'hire_unit', v_row.hire_unit, 'purchase_price_pence', v_row.purchase_price_pence,
      'acquired_on', v_row.acquired_on, 'condition', v_row.condition, 'active', v_row.active,
      'hires_count', 0, 'out_now', 0, 'created_at', v_row.created_at));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. venue_create_equipment_hire
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_create_equipment_hire(p_venue_token text, p_equipment_id uuid, p_qty integer, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_team_id text DEFAULT NULL::text, p_booked_by_name text DEFAULT NULL::text, p_due_back_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booking_id uuid DEFAULT NULL::uuid, p_fixture_id uuid DEFAULT NULL::uuid, p_contact_email text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_amount_pence integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_eq record; v_peak int; v_free int;
        v_hire_id uuid; v_fee int; v_charge_id uuid; v_deposit int; v_dep_status text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'equipment') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0001'; END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NULL AND NULLIF(trim(COALESCE(p_booked_by_name,'')),'') IS NULL THEN
    RAISE EXCEPTION 'booker_required' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_eq FROM equipment WHERE id = p_equipment_id FOR UPDATE;
  IF v_eq.id IS NULL THEN RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_eq.venue_id <> v_venue_id THEN RAISE EXCEPTION 'equipment_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF NOT v_eq.active THEN RAISE EXCEPTION 'equipment_inactive' USING ERRCODE = 'P0001'; END IF;

  v_peak := public._equipment_peak_committed(p_equipment_id, p_start_at, p_end_at);
  v_free := v_eq.quantity - v_peak;
  IF p_qty > v_free THEN
    INSERT INTO equipment_demand_misses (venue_id, category, equipment_id, window_start, window_end, qty_wanted, source)
    VALUES (v_venue_id, v_eq.category, p_equipment_id, p_start_at, p_end_at, p_qty, 'venue');
    INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'equipment_demand_miss', 'equipment', p_equipment_id::text,
            jsonb_build_object('venue_id', v_venue_id, 'category', v_eq.category, 'wanted', p_qty, 'free', GREATEST(v_free,0)));
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_quantity', 'free', GREATEST(v_free,0), 'wanted', p_qty);
  END IF;

  -- deposit snapshot: a refundable hold, tracked on the hire row (not the ledger)
  v_deposit := COALESCE(v_eq.deposit_pence, 0);
  v_dep_status := CASE WHEN v_deposit > 0 THEN 'held' ELSE 'none' END;

  INSERT INTO equipment_bookings (equipment_id, venue_id, team_id, booked_by_name, qty,
                                  start_at, end_at, due_back_at, booking_id, fixture_id,
                                  status, amount_pence, contact_email, contact_phone,
                                  deposit_pence, deposit_status)
  VALUES (p_equipment_id, v_venue_id, p_team_id, NULLIF(trim(COALESCE(p_booked_by_name,'')),''), p_qty,
          p_start_at, p_end_at, p_due_back_at, p_booking_id, p_fixture_id,
          'confirmed', COALESCE(p_amount_pence, v_eq.default_fee_pence),
          NULLIF(p_contact_email,''), NULLIF(p_contact_phone,''),
          v_deposit, v_dep_status)
  RETURNING id INTO v_hire_id;

  v_fee := COALESCE(NULLIF(p_amount_pence, 0), v_eq.default_fee_pence, 0);
  IF v_fee > 0 THEN
    INSERT INTO venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_venue_id, 'equipment', v_hire_id::text, p_team_id, NULL, v_fee, 'unpaid', p_start_at::date)
    ON CONFLICT (source_type, source_id, COALESCE(team_id, '')) DO NOTHING
    RETURNING id INTO v_charge_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(p_team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'equipment_hired', 'equipment_booking', v_hire_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'equipment_id', p_equipment_id, 'qty', p_qty,
                             'fee_pence', v_fee, 'deposit_pence', v_deposit, 'booking_id', p_booking_id, 'fixture_id', p_fixture_id));

  RETURN jsonb_build_object('ok', true, 'hire_id', v_hire_id, 'charge_id', v_charge_id,
    'fee_pence', v_fee, 'deposit_pence', v_deposit, 'free_after', GREATEST(v_free - p_qty, 0));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. venue_cancel_equipment_hire
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_cancel_equipment_hire(p_venue_token text, p_hire_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_hire record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'equipment') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_hire FROM equipment_bookings WHERE id = p_hire_id;
  IF v_hire.id IS NULL THEN RAISE EXCEPTION 'hire_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.venue_id <> v_venue_id THEN RAISE EXCEPTION 'hire_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.status IN ('cancelled','declined','returned') THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'status', v_hire.status);
  END IF;

  UPDATE equipment_bookings SET status = 'cancelled' WHERE id = p_hire_id;
  -- refund (void) its charge: drops from owed/collected, payments kept
  UPDATE venue_charges SET status = 'refunded'
    WHERE source_type = 'equipment' AND source_id = p_hire_id::text AND status <> 'refunded';

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_hire.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'equipment_hire_cancelled', 'equipment_booking', p_hire_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'equipment_id', v_hire.equipment_id, 'prev_status', v_hire.status));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'status', 'cancelled');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. venue_mark_equipment_out
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_mark_equipment_out(p_venue_token text, p_hire_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_hire record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'equipment') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_hire FROM equipment_bookings WHERE id = p_hire_id;
  IF v_hire.id IS NULL THEN RAISE EXCEPTION 'hire_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.venue_id <> v_venue_id THEN RAISE EXCEPTION 'hire_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.status = 'out' THEN RETURN jsonb_build_object('ok', true, 'already', true, 'status', 'out'); END IF;
  IF v_hire.status <> 'confirmed' THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001', DETAIL = v_hire.status || '->out'; END IF;

  UPDATE equipment_bookings SET status = 'out', handed_out_at = now() WHERE id = p_hire_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_hire.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'equipment_handed_out', 'equipment_booking', p_hire_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'equipment_id', v_hire.equipment_id, 'qty', v_hire.qty));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'status', 'out');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. venue_mark_equipment_returned
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_mark_equipment_returned(p_venue_token text, p_hire_id uuid, p_condition text DEFAULT NULL::text, p_forfeit_deposit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_hire record; v_new_dep text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_feature_enabled(v_venue_id, 'equipment') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_condition IS NOT NULL AND p_condition NOT IN ('new','good','worn','damaged','retired') THEN
    RAISE EXCEPTION 'invalid_condition' USING ERRCODE = 'P0001', DETAIL = p_condition; END IF;

  SELECT * INTO v_hire FROM equipment_bookings WHERE id = p_hire_id;
  IF v_hire.id IS NULL THEN RAISE EXCEPTION 'hire_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.venue_id <> v_venue_id THEN RAISE EXCEPTION 'hire_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF v_hire.status NOT IN ('confirmed','out') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001', DETAIL = v_hire.status || '->returned'; END IF;

  v_new_dep := CASE WHEN v_hire.deposit_status = 'held'
                    THEN (CASE WHEN p_forfeit_deposit THEN 'forfeited' ELSE 'released' END)
                    ELSE v_hire.deposit_status END;

  UPDATE equipment_bookings SET
    status = 'returned', returned_at = now(), returned_condition = p_condition,
    deposit_status = v_new_dep,
    deposit_resolved_at = CASE WHEN v_hire.deposit_status = 'held' THEN now() ELSE deposit_resolved_at END
  WHERE id = p_hire_id;

  -- write the returned condition back to the catalogue item (asset condition tracking)
  IF p_condition IS NOT NULL THEN
    UPDATE equipment SET condition = p_condition, updated_at = now() WHERE id = v_hire.equipment_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (COALESCE(v_hire.team_id, v_venue_id), auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'equipment_returned', 'equipment_booking', p_hire_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'equipment_id', v_hire.equipment_id,
                             'condition', p_condition, 'deposit_status', v_new_dep, 'deposit_pence', v_hire.deposit_pence));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'status', 'returned', 'deposit_status', v_new_dep);
END;
$function$;

-- ─── room_hire ───────────────────────────────────────────────────────────────────
-- 399_guards_room_hire.sql
--
-- Feature-flag guards for the ROOM HIRE write RPCs.
--
-- Adds a single guard block to each of the 5 room-hire write functions:
--
--   IF NOT public._venue_feature_enabled(<venue_id>, 'room_hire') THEN
--     RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
--   END IF;
--
-- The helper _venue_feature_enabled(p_venue_id text, p_feature text) returns
-- true by default (no venue_features row => enabled), so the guard is a no-op
-- until an operator explicitly disables 'room_hire' for a venue.
--
-- The guard is inserted immediately after the function's venue_id is
-- resolved/validated and BEFORE any write. venue_id columns are text across
-- venue_room_hires / venue_spaces / venues, matching the helper signature —
-- no casts required.
--
-- Each body is byte-identical to the live definition EXCEPT for the one guard
-- block. Signatures, RETURNS, volatility, SECURITY DEFINER, SET search_path,
-- LANGUAGE and $function$ tags are preserved verbatim. GRANTs untouched.
--
-- DRAFT — not yet applied. Next free migration after this = 400.

-- ============================================================================
-- 1. venue_confirm_room_hire  (venue-token; guard on v_hire.venue_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.venue_confirm_room_hire(p_venue_token text, p_hire_id uuid, p_price_pence integer, p_deposit_pence integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_hire      public.venue_room_hires;
  v_charge_id uuid;
  v_recipient text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_hire FROM public.venue_room_hires WHERE id = p_hire_id;
  IF NOT FOUND OR v_hire.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'hire_not_found' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_feature_enabled(v_hire.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_hire.status <> 'requested' THEN RAISE EXCEPTION 'not_confirmable' USING ERRCODE='P0001'; END IF;
  IF p_price_pence IS NULL OR p_price_pence < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF p_deposit_pence IS NOT NULL AND p_deposit_pence < 0 THEN RAISE EXCEPTION 'bad_deposit' USING ERRCODE='P0001'; END IF;

  UPDATE public.venue_room_hires
     SET status = 'confirmed', price_pence = p_price_pence, deposit_pence = p_deposit_pence
   WHERE id = p_hire_id;

  IF p_price_pence > 0
     AND NOT EXISTS (SELECT 1 FROM public.venue_charges
                      WHERE source_type = 'room_hire' AND source_id = p_hire_id::text AND status <> 'refunded') THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_hire.venue_id, 'room_hire', p_hire_id::text, p_price_pence, 'unpaid', v_hire.starts_at::date)
    RETURNING id INTO v_charge_id;
  END IF;

  UPDATE public.equipment_bookings SET status = 'confirmed'
   WHERE room_hire_id = p_hire_id AND status = 'requested';

  v_recipient := COALESCE(v_hire.booker_email,
                          (SELECT email FROM public.member_profiles WHERE id = v_hire.member_profile_id));
  IF v_recipient IS NOT NULL THEN
    INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
    SELECT v_hire.venue_id, v_hire.member_profile_id::text, 'room_hire_confirmed', p_hire_id::text, v_recipient, now(),
           jsonb_build_object('venue_name', vn.name, 'space_name', sp.name, 'starts_at', v_hire.starts_at,
                              'purpose', v_hire.purpose, 'price_pence', p_price_pence, 'deposit_pence', p_deposit_pence)
      FROM public.venues vn, public.venue_spaces sp
     WHERE vn.id = v_hire.venue_id AND sp.id = v_hire.space_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_hire.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'room_hire_confirmed', 'venue_room_hire', p_hire_id::text,
          jsonb_build_object('price_pence', p_price_pence, 'deposit_pence', p_deposit_pence));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'charge_id', v_charge_id);
END;
$function$;

-- ============================================================================
-- 2. venue_cancel_room_hire  (venue-token; guard on v_hire.venue_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.venue_cancel_room_hire(p_venue_token text, p_hire_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    record;
  v_hire      public.venue_room_hires;
  v_refunded  int := 0;
  v_recipient text;
  v_new_dep   text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_hire FROM public.venue_room_hires WHERE id = p_hire_id;
  IF NOT FOUND OR v_hire.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'hire_not_found' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_feature_enabled(v_hire.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_hire.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  -- a held deposit is returned on cancellation
  v_new_dep := CASE WHEN v_hire.deposit_status = 'held' THEN 'returned' ELSE v_hire.deposit_status END;

  UPDATE public.venue_room_hires
     SET status = 'cancelled', deposit_status = v_new_dep
   WHERE id = p_hire_id;

  UPDATE public.venue_charges SET status = 'refunded'
   WHERE source_type = 'room_hire' AND source_id = p_hire_id::text AND status <> 'refunded';
  GET DIAGNOSTICS v_refunded = ROW_COUNT;

  UPDATE public.equipment_bookings SET status = 'cancelled'
   WHERE room_hire_id = p_hire_id AND status IN ('requested','confirmed');

  v_recipient := COALESCE(v_hire.booker_email,
                          (SELECT email FROM public.member_profiles WHERE id = v_hire.member_profile_id));
  IF v_recipient IS NOT NULL THEN
    INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
    SELECT v_hire.venue_id, v_hire.member_profile_id::text, 'room_hire_cancelled', p_hire_id::text, v_recipient, now(),
           jsonb_build_object('venue_name', vn.name, 'space_name', sp.name, 'starts_at', v_hire.starts_at,
                              'purpose', v_hire.purpose, 'reason', COALESCE(p_reason,''))
      FROM public.venues vn, public.venue_spaces sp
     WHERE vn.id = v_hire.venue_id AND sp.id = v_hire.space_id;
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_hire.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'room_hire_cancelled', 'venue_room_hire', p_hire_id::text,
          jsonb_build_object('reason', COALESCE(p_reason,''), 'refunded', v_refunded, 'deposit_status', v_new_dep));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'refunded', v_refunded, 'deposit_status', v_new_dep);
END;
$function$;

-- ============================================================================
-- 3. venue_record_hire_deposit  (venue-token; guard on v_hire.venue_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.venue_record_hire_deposit(p_venue_token text, p_hire_id uuid, p_deposit_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_hire public.venue_room_hires;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  IF p_deposit_status NOT IN ('none','held','returned','forfeited') THEN
    RAISE EXCEPTION 'bad_deposit_status' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_hire FROM public.venue_room_hires WHERE id = p_hire_id;
  IF NOT FOUND OR v_hire.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'hire_not_found' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_feature_enabled(v_hire.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venue_room_hires SET deposit_status = p_deposit_status WHERE id = p_hire_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_hire.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'room_hire_deposit_recorded', 'venue_room_hire', p_hire_id::text,
          jsonb_build_object('deposit_status', p_deposit_status));

  RETURN jsonb_build_object('ok', true, 'hire_id', p_hire_id, 'deposit_status', p_deposit_status);
END;
$function$;

-- ============================================================================
-- 4. member_request_room_hire  (authenticated member; guard on v_space.venue_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.member_request_room_hire(p_space_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_purpose text, p_attendee_count integer DEFAULT NULL::integer, p_equipment_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile public.member_profiles;
  v_space   public.venue_spaces;
  v_open    int;
  v_hire_id uuid;
  v_eid     uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  IF p_purpose IS NULL OR length(btrim(p_purpose)) = 0 THEN
    RAISE EXCEPTION 'purpose_required' USING ERRCODE='P0001';
  END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'bad_time_range' USING ERRCODE='P0001'; END IF;
  IF p_starts_at <= now() THEN RAISE EXCEPTION 'starts_in_past' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_space FROM public.venue_spaces WHERE id = p_space_id;
  IF NOT FOUND OR NOT v_space.is_active THEN RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_feature_enabled(v_space.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  -- throttle: at most 5 open ('requested') hires for this member at this space
  SELECT count(*) INTO v_open FROM public.venue_room_hires
   WHERE space_id = p_space_id AND member_profile_id = v_profile.id AND status = 'requested';
  IF v_open >= 5 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_requests'); END IF;

  IF NOT public._space_is_available(p_space_id, p_starts_at, p_ends_at) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'space_unavailable');
  END IF;

  INSERT INTO public.venue_room_hires
    (venue_id, space_id, booker_type, member_profile_id, booker_name, booker_email, booker_phone,
     starts_at, ends_at, purpose, attendee_count, status)
  VALUES
    (v_space.venue_id, p_space_id, 'member', v_profile.id,
     btrim(COALESCE(v_profile.first_name,'') || ' ' || COALESCE(v_profile.last_name,'')),
     v_profile.email, v_profile.phone,
     p_starts_at, p_ends_at, btrim(p_purpose), p_attendee_count, 'requested')
  RETURNING id INTO v_hire_id;

  -- optional equipment add-ons (only kit belonging to this venue), recorded as
  -- 'requested' — the venue prices/charges these on confirm.
  IF p_equipment_ids IS NOT NULL THEN
    FOREACH v_eid IN ARRAY p_equipment_ids LOOP
      IF EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = v_eid AND e.venue_id = v_space.venue_id) THEN
        INSERT INTO public.equipment_bookings
          (equipment_id, venue_id, room_hire_id, qty, start_at, end_at, status, booked_by_name)
        VALUES
          (v_eid, v_space.venue_id, v_hire_id, 1, p_starts_at, p_ends_at, 'requested',
           btrim(COALESCE(v_profile.first_name,'') || ' ' || COALESCE(v_profile.last_name,'')));
      END IF;
    END LOOP;
  END IF;

  -- acknowledge the request to the booker (drained by roomHireNotificationsJob)
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_space.venue_id, v_profile.id::text, 'room_hire_requested', v_hire_id::text, v_profile.email, now(),
         jsonb_build_object('venue_name', vn.name, 'space_name', v_space.name,
                            'starts_at', p_starts_at, 'purpose', btrim(p_purpose))
    FROM public.venues vn WHERE vn.id = v_space.venue_id AND v_profile.email IS NOT NULL;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_space.venue_id, v_uid, 'player', 'room_hire_requested', 'venue_room_hire', v_hire_id::text,
          jsonb_build_object('space_id', p_space_id, 'member_profile_id', v_profile.id,
                             'starts_at', p_starts_at, 'ends_at', p_ends_at));

  RETURN jsonb_build_object('ok', true, 'hire_id', v_hire_id, 'status', 'requested');
END;
$function$;

-- ============================================================================
-- 5. public_enquire_room_hire  (anon public; guard on v_space.venue_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.public_enquire_room_hire(p_space_id uuid, p_name text, p_email text, p_phone text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_purpose text, p_attendee_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_space   public.venue_spaces;
  v_recent  int;
  v_hire_id uuid;
BEGIN
  SELECT * INTO v_space FROM public.venue_spaces WHERE id = p_space_id;
  IF NOT FOUND OR NOT v_space.is_active THEN RAISE EXCEPTION 'space_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT v_space.is_enquiry_only THEN RAISE EXCEPTION 'not_enquiry_only' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_feature_enabled(v_space.venue_id, 'room_hire') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  IF p_email IS NULL OR position('@' IN p_email) = 0 OR length(p_email) > 160 THEN
    RAISE EXCEPTION 'bad_email' USING ERRCODE='P0001';
  END IF;
  IF p_purpose IS NULL OR length(btrim(p_purpose)) = 0 THEN RAISE EXCEPTION 'purpose_required' USING ERRCODE='P0001'; END IF;
  IF length(btrim(p_name)) > 120 OR length(btrim(p_purpose)) > 500
     OR (p_phone IS NOT NULL AND length(p_phone) > 40) THEN
    RAISE EXCEPTION 'input_too_long' USING ERRCODE='P0001';
  END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'bad_time_range' USING ERRCODE='P0001'; END IF;

  -- abuse throttle: at most 3 enquiries from this email for this space in 10 min
  SELECT count(*) INTO v_recent FROM public.venue_room_hires
   WHERE space_id = p_space_id AND lower(booker_email) = lower(btrim(p_email))
     AND created_at > now() - INTERVAL '10 minutes';
  IF v_recent >= 3 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_requests'); END IF;

  INSERT INTO public.venue_room_hires
    (venue_id, space_id, booker_type, booker_name, booker_email, booker_phone,
     starts_at, ends_at, purpose, attendee_count, status)
  VALUES
    (v_space.venue_id, p_space_id, 'non_member', btrim(p_name), btrim(p_email),
     NULLIF(btrim(COALESCE(p_phone,'')), ''),
     p_starts_at, p_ends_at, btrim(p_purpose), p_attendee_count, 'requested')
  RETURNING id INTO v_hire_id;

  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_space.venue_id, NULL, 'room_hire_requested', v_hire_id::text, btrim(p_email), now(),
         jsonb_build_object('venue_name', vn.name, 'space_name', v_space.name,
                            'starts_at', p_starts_at, 'purpose', btrim(p_purpose))
    FROM public.venues vn WHERE vn.id = v_space.venue_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_space.venue_id, NULL, 'system', 'public_enquiry', 'room_hire_enquired', 'venue_room_hire', v_hire_id::text,
          jsonb_build_object('space_id', p_space_id, 'email', btrim(p_email), 'starts_at', p_starts_at));

  RETURN jsonb_build_object('ok', true, 'hire_id', v_hire_id);
END;
$function$;

-- ─── memberships ───────────────────────────────────────────────────────────────────
-- 399_guards_memberships.sql
-- Feature-flag guards for the MEMBERSHIPS (club-owned) feature's write RPCs.
--
-- 'memberships' is a CLUB-owned feature. The RPCs below are venue-token RPCs
-- that resolve only a venue_id (no specific club_id), so they gate on the UNION
-- helper public._venue_club_feature_enabled(<venue_id>, 'memberships'), which
-- returns true if ANY club attached to that venue has the feature enabled.
-- member_enrol_membership is member-facing; its venue_id is derived from the
-- invite code (invite_links.entity_id, entity_type='venue') and feeds the same
-- union helper.
--
-- Each body is byte-identical to live EXCEPT for ONE inserted guard block,
-- placed immediately after the venue_id is known-valid and BEFORE any write:
--   IF NOT public._venue_club_feature_enabled(<venue_id>, 'memberships') THEN
--     RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
--   END IF;
--
-- GATED (10): venue_create_membership_tier, venue_update_membership_tier,
--   venue_enrol_membership, venue_freeze_membership, venue_cancel_membership,
--   venue_approve_and_enrol, venue_create_fee_plan, venue_enrol_fee,
--   venue_cancel_fee, member_enrol_membership.
-- SKIPPED (not in this file, reachable from always-on CORE "Customers" screen):
--   venue_create_customer, venue_update_customer, venue_erase_customer,
--   venue_approve_customer.
--
-- Signatures / RETURNS / volatility / SECURITY DEFINER / SET search_path /
-- LANGUAGE / $function$ tags preserved verbatim. GRANTs untouched.

-- =====================================================================
-- 1. venue_create_membership_tier
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_create_membership_tier(p_venue_token text, p_name text, p_benefits jsonb DEFAULT '{}'::jsonb, p_prices jsonb DEFAULT '[]'::jsonb, p_audience text DEFAULT 'all'::text, p_pricing_model text DEFAULT 'recurring'::text, p_season_start date DEFAULT NULL::date, p_season_end date DEFAULT NULL::date, p_proration_basis text DEFAULT 'none'::text, p_joining_fee_pence integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_name text := NULLIF(btrim(p_name), '');
  v_tier uuid;
  v_pr   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001'; END IF;
  IF p_audience NOT IN ('all','adult','junior','child') THEN
    RAISE EXCEPTION 'invalid_audience' USING ERRCODE = 'P0001';
  END IF;
  IF p_pricing_model NOT IN ('recurring','season') THEN
    RAISE EXCEPTION 'invalid_pricing_model' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_proration_basis,'none') NOT IN ('none','monthly','weekly','daily') THEN
    RAISE EXCEPTION 'invalid_proration_basis' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_joining_fee_pence,0) < 0 THEN
    RAISE EXCEPTION 'invalid_joining_fee' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_membership_tiers
    (venue_id, name, benefits, audience, pricing_model, season_start, season_end,
     proration_basis, joining_fee_pence)
  VALUES
    (v_venue_id, v_name, COALESCE(p_benefits, '{}'::jsonb),
     p_audience, p_pricing_model, p_season_start, p_season_end,
     COALESCE(p_proration_basis,'none'), COALESCE(p_joining_fee_pence,0))
  RETURNING id INTO v_tier;

  FOR v_pr IN SELECT * FROM jsonb_array_elements(COALESCE(p_prices, '[]'::jsonb)) LOOP
    IF (v_pr->>'period') NOT IN ('monthly','quarterly','annual','season') THEN
      RAISE EXCEPTION 'invalid_period' USING ERRCODE = 'P0001', DETAIL = (v_pr->>'period');
    END IF;
    INSERT INTO public.venue_tier_prices (tier_id, period, price_pence, price_type)
    VALUES (
      v_tier,
      v_pr->>'period',
      (v_pr->>'price_pence')::int,
      COALESCE(v_pr->>'price_type', 'standard')
    );
  END LOOP;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_tier_created', 'venue_membership_tier', v_tier::text,
          jsonb_build_object('venue_id', v_venue_id, 'name', v_name,
                             'audience', p_audience, 'pricing_model', p_pricing_model,
                             'proration_basis', COALESCE(p_proration_basis,'none'),
                             'joining_fee_pence', COALESCE(p_joining_fee_pence,0),
                             'prices', COALESCE(p_prices, '[]'::jsonb)));
  RETURN jsonb_build_object('ok', true, 'tier_id', v_tier);
END;
$function$;

-- =====================================================================
-- 2. venue_update_membership_tier
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_update_membership_tier(p_venue_token text, p_tier_id uuid, p_name text DEFAULT NULL::text, p_benefits jsonb DEFAULT NULL::jsonb, p_active boolean DEFAULT NULL::boolean, p_prices jsonb DEFAULT NULL::jsonb, p_audience text DEFAULT NULL::text, p_pricing_model text DEFAULT NULL::text, p_season_start date DEFAULT NULL::date, p_season_end date DEFAULT NULL::date, p_proration_basis text DEFAULT NULL::text, p_joining_fee_pence integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_id uuid;
  v_pr jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_audience IS NOT NULL AND p_audience NOT IN ('all','adult','junior','child') THEN
    RAISE EXCEPTION 'invalid_audience' USING ERRCODE = 'P0001';
  END IF;
  IF p_pricing_model IS NOT NULL AND p_pricing_model NOT IN ('recurring','season') THEN
    RAISE EXCEPTION 'invalid_pricing_model' USING ERRCODE = 'P0001';
  END IF;
  IF p_proration_basis IS NOT NULL AND p_proration_basis NOT IN ('none','monthly','weekly','daily') THEN
    RAISE EXCEPTION 'invalid_proration_basis' USING ERRCODE = 'P0001';
  END IF;
  IF p_joining_fee_pence IS NOT NULL AND p_joining_fee_pence < 0 THEN
    RAISE EXCEPTION 'invalid_joining_fee' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venue_membership_tiers SET
    name              = COALESCE(NULLIF(btrim(p_name), ''), name),
    benefits          = COALESCE(p_benefits, benefits),
    active            = COALESCE(p_active, active),
    audience          = COALESCE(p_audience, audience),
    pricing_model     = COALESCE(p_pricing_model, pricing_model),
    season_start      = CASE WHEN p_pricing_model = 'season' THEN p_season_start ELSE season_start END,
    season_end        = CASE WHEN p_pricing_model = 'season' THEN p_season_end   ELSE season_end   END,
    proration_basis   = COALESCE(p_proration_basis, proration_basis),
    joining_fee_pence = COALESCE(p_joining_fee_pence, joining_fee_pence),
    updated_at        = now()
  WHERE id = p_tier_id AND venue_id = v_venue_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE = 'P0001'; END IF;

  IF p_prices IS NOT NULL THEN
    FOR v_pr IN SELECT * FROM jsonb_array_elements(p_prices) LOOP
      IF (v_pr->>'period') NOT IN ('monthly','quarterly','annual','season') THEN
        RAISE EXCEPTION 'invalid_period' USING ERRCODE = 'P0001', DETAIL = (v_pr->>'period');
      END IF;
      INSERT INTO public.venue_tier_prices (tier_id, period, price_pence, price_type)
      VALUES (
        v_id,
        v_pr->>'period',
        (v_pr->>'price_pence')::int,
        COALESCE(v_pr->>'price_type', 'standard')
      )
      ON CONFLICT (tier_id, period, price_type)
        DO UPDATE SET price_pence = EXCLUDED.price_pence, active = true;
    END LOOP;
  END IF;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_tier_updated', 'venue_membership_tier', v_id::text,
          jsonb_build_object('venue_id', v_venue_id,
                             'proration_basis', p_proration_basis,
                             'joining_fee_pence', p_joining_fee_pence));
  RETURN jsonb_build_object('ok', true, 'tier_id', v_id);
END;
$function$;

-- =====================================================================
-- 3. venue_enrol_membership
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_enrol_membership(p_venue_token text, p_customer_id uuid, p_tier_id uuid, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_price      int;
  v_mid        uuid;
  v_renews     date;
  v_season_end date;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001';
  END IF;
  IF p_period NOT IN ('monthly','quarterly','annual','season') THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.venue_customers WHERE id=p_customer_id AND venue_id=v_venue_id AND status<>'erased') THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0001';
  END IF;

  -- Fetch tier + season_end in one pass (also validates tier belongs to this venue)
  SELECT season_end INTO v_season_end
    FROM public.venue_membership_tiers
   WHERE id=p_tier_id AND venue_id=v_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;

  SELECT price_pence INTO v_price
    FROM public.venue_tier_prices
   WHERE tier_id=p_tier_id AND period=p_period AND active;
  IF v_price IS NULL THEN RAISE EXCEPTION 'price_not_set' USING ERRCODE='P0001'; END IF;

  -- Season memberships are one-off: renews_at = season_end (or far future if unset)
  IF p_period = 'season' THEN
    v_renews := COALESCE(v_season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  BEGIN
    INSERT INTO public.venue_memberships
      (venue_id, customer_id, tier_id, period, amount_pence, status, started_at, renews_at)
    VALUES (v_venue_id, p_customer_id, p_tier_id, p_period, v_price, 'active', current_date, v_renews)
    RETURNING id INTO v_mid;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE='P0001';
  END;

  INSERT INTO public.venue_charges
    (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  VALUES (v_venue_id, 'membership', v_mid::text || ':' || current_date::text,
          NULL, NULL, v_price, 'unpaid', current_date)
  ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_enrolled','venue_membership', v_mid::text,
          jsonb_build_object('venue_id', v_venue_id, 'tier_id', p_tier_id,
                             'period', p_period, 'amount_pence', v_price));
  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid,
                            'amount_pence', v_price, 'renews_at', v_renews);
END;
$function$;

-- =====================================================================
-- 4. venue_freeze_membership
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_freeze_membership(p_venue_token text, p_membership_id uuid, p_until date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_id uuid; v_days int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF p_until IS NULL OR p_until <= current_date THEN RAISE EXCEPTION 'invalid_freeze_until' USING ERRCODE='P0001'; END IF;
  v_days := p_until - current_date;

  UPDATE public.venue_memberships SET
    status='paused', frozen_until=p_until, renews_at = renews_at + (v_days || ' days')::interval, updated_at=now()
  WHERE id=p_membership_id AND venue_id=v_venue_id AND status='active' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'membership_not_active' USING ERRCODE='P0001'; END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_frozen','venue_membership', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'frozen_until', p_until, 'days', v_days));
  RETURN jsonb_build_object('ok', true, 'membership_id', v_id, 'frozen_until', p_until);
END; $function$;

-- =====================================================================
-- 5. venue_cancel_membership
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_cancel_membership(p_venue_token text, p_membership_id uuid, p_immediate boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_id uuid; v_status text; v_renews date;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;

  IF p_immediate THEN
    UPDATE public.venue_memberships SET status='cancelled', cancel_at=current_date, updated_at=now()
    WHERE id=p_membership_id AND venue_id=v_venue_id AND status IN ('active','paused','ending')
    RETURNING id, status, renews_at INTO v_id, v_status, v_renews;
  ELSE
    UPDATE public.venue_memberships SET status='ending', cancel_at=renews_at, updated_at=now()
    WHERE id=p_membership_id AND venue_id=v_venue_id AND status IN ('active','paused')
    RETURNING id, status, renews_at INTO v_id, v_status, v_renews;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'membership_not_cancellable' USING ERRCODE='P0001'; END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_cancelled','venue_membership', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'immediate', p_immediate));
  RETURN jsonb_build_object('ok', true, 'membership_id', v_id, 'status', v_status);
END; $function$;

-- =====================================================================
-- 6. venue_approve_and_enrol
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_approve_and_enrol(p_venue_token text, p_customer_id uuid, p_tier_id uuid, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue_id text; v_price int; v_is_free boolean; v_mid uuid; v_renews date; v_status text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF p_period NOT IN ('monthly','quarterly','annual') THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001'; END IF;
  SELECT status INTO v_status FROM public.venue_customers WHERE id=p_customer_id AND venue_id=v_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0001'; END IF;
  IF v_status = 'erased' THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0001'; END IF;
  SELECT COALESCE((benefits->>'is_free')::boolean, false) INTO v_is_free
    FROM public.venue_membership_tiers WHERE id=p_tier_id AND venue_id=v_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;
  IF v_is_free THEN
    v_price := 0; v_renews := DATE '2999-01-01';
  ELSE
    SELECT price_pence INTO v_price FROM public.venue_tier_prices WHERE tier_id=p_tier_id AND period=p_period AND active;
    IF v_price IS NULL THEN RAISE EXCEPTION 'price_not_set' USING ERRCODE='P0001'; END IF;
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;
  UPDATE public.venue_customers SET status='active', requested_tier_id=NULL, updated_at=now()
   WHERE id=p_customer_id AND venue_id=v_venue_id;
  BEGIN
    INSERT INTO public.venue_memberships (venue_id, customer_id, tier_id, period, amount_pence, status, started_at, renews_at)
    VALUES (v_venue_id, p_customer_id, p_tier_id, p_period, v_price, 'active', current_date, v_renews)
    RETURNING id INTO v_mid;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE='P0001';
  END;
  IF v_price > 0 THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
    VALUES (v_venue_id, 'membership', v_mid::text || ':' || current_date::text, NULL, NULL, v_price, 'unpaid', current_date)
    ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;
  END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_membership_enrolled','venue_membership', v_mid::text,
          jsonb_build_object('venue_id', v_venue_id, 'tier_id', p_tier_id, 'period', p_period, 'amount_pence', v_price, 'via', 'approve_and_enrol'));
  PERFORM public.notify_venue_change(v_venue_id, 'customer_approved');
  RETURN jsonb_build_object('ok', true, 'membership_id', v_mid, 'amount_pence', v_price, 'renews_at', v_renews);
END; $function$;

-- =====================================================================
-- 7. venue_create_fee_plan
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_create_fee_plan(p_venue_token text, p_name text, p_amount_pence integer, p_period text, p_sport text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_name text := NULLIF(btrim(p_name),''); v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  IF p_period NOT IN ('weekly','monthly','quarterly','annual') THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001'; END IF;
  IF p_amount_pence IS NULL OR p_amount_pence < 0 THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.venue_fee_plans (venue_id, name, amount_pence, period, sport)
  VALUES (v_venue_id, v_name, p_amount_pence, p_period, NULLIF(btrim(p_sport),'')) RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_fee_plan_created','venue_fee_plan', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'amount_pence', p_amount_pence, 'period', p_period));
  RETURN jsonb_build_object('ok', true, 'plan_id', v_id);
END; $function$;

-- =====================================================================
-- 8. venue_enrol_fee
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_enrol_fee(p_venue_token text, p_plan_id uuid, p_member_key text, p_team_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_amount int; v_period text; v_key text := NULLIF(btrim(p_member_key),''); v_next date; v_sid uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'member_key_required' USING ERRCODE='P0001'; END IF;

  SELECT amount_pence, period INTO v_amount, v_period FROM public.venue_fee_plans
   WHERE id=p_plan_id AND venue_id=v_venue_id AND active;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'plan_not_found' USING ERRCODE='P0001'; END IF;
  IF p_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams WHERE id=p_team_id) THEN
    RAISE EXCEPTION 'team_not_found' USING ERRCODE='P0001'; END IF;

  v_next := current_date + public._membership_period_interval(v_period);

  INSERT INTO public.venue_fee_subscriptions (venue_id, plan_id, member_key, team_id, status, started_at, next_charge_at)
  VALUES (v_venue_id, p_plan_id, v_key, p_team_id, 'active', current_date, v_next) RETURNING id INTO v_sid;

  INSERT INTO public.venue_charges (venue_id, source_type, source_id, team_id, competition_id, amount_due_pence, status, due_date)
  VALUES (v_venue_id, 'fee', v_sid::text || ':' || current_date::text, p_team_id, NULL, v_amount, 'unpaid', current_date)
  ON CONFLICT (source_type, source_id, COALESCE(team_id,'')) DO NOTHING;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_fee_enrolled','venue_fee_subscription', v_sid::text,
          jsonb_build_object('venue_id', v_venue_id, 'plan_id', p_plan_id, 'member_key', v_key, 'amount_pence', v_amount));
  RETURN jsonb_build_object('ok', true, 'subscription_id', v_sid, 'amount_pence', v_amount, 'next_charge_at', v_next);
END; $function$;

-- =====================================================================
-- 9. venue_cancel_fee
-- =====================================================================
CREATE OR REPLACE FUNCTION public.venue_cancel_fee(p_venue_token text, p_subscription_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  UPDATE public.venue_fee_subscriptions SET status='cancelled', cancel_at=current_date
   WHERE id=p_subscription_id AND venue_id=v_venue_id AND status='active' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'subscription_not_active' USING ERRCODE='P0001'; END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_fee_cancelled','venue_fee_subscription', v_id::text, jsonb_build_object('venue_id', v_venue_id));
  RETURN jsonb_build_object('ok', true, 'subscription_id', v_id);
END; $function$;

-- =====================================================================
-- 10. member_enrol_membership (member-facing)
--     venue_id derived from invite code: invite_links.entity_id where
--     entity_type='venue' AND action='venue_landing'. Guard inserted
--     immediately after v_venue_id := v_link.entity_id; before any write.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.member_enrol_membership(p_invite_code text, p_tier_id uuid, p_period text, p_for_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid            uuid := auth.uid();
  v_link           record;
  v_venue_id       text;
  v_payer_profile  uuid;
  v_member_profile uuid;
  v_tier           record;
  v_price          int;
  v_amount         int;
  v_club_id        text;
  v_mid            uuid;
  v_renews         date;
  v_pass_token     text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;

  SELECT entity_id, active INTO v_link
  FROM public.invite_links
  WHERE code = btrim(p_invite_code)
    AND entity_type = 'venue'
    AND action = 'venue_landing';
  IF NOT FOUND OR NOT v_link.active THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_link.entity_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'memberships') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_period NOT IN ('monthly','quarterly','annual','season') THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_payer_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_payer_profile IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE='P0001';
  END IF;

  IF p_for_profile_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.member_guardians
      WHERE child_profile_id    = p_for_profile_id
        AND guardian_profile_id = v_payer_profile
        AND invite_state        = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
    END IF;
    v_member_profile := p_for_profile_id;
  ELSE
    v_member_profile := v_payer_profile;
  END IF;

  SELECT id, season_start, season_end, pricing_model, proration_basis, joining_fee_pence
    INTO v_tier
  FROM public.venue_membership_tiers
  WHERE id = p_tier_id AND venue_id = v_venue_id AND active
    AND COALESCE((benefits->>'self_signup')::boolean, false) = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'tier_not_found' USING ERRCODE='P0001'; END IF;

  SELECT price_pence INTO v_price
  FROM public.venue_tier_prices
  WHERE tier_id = p_tier_id AND period = p_period AND active;
  IF v_price IS NULL THEN RAISE EXCEPTION 'price_not_set' USING ERRCODE='P0001'; END IF;

  IF v_tier.pricing_model = 'season' THEN
    v_amount := COALESCE(v_tier.joining_fee_pence, 0)
              + public._prorated_first_charge(v_price, COALESCE(v_tier.proration_basis,'none'),
                                              current_date, v_tier.season_start, v_tier.season_end);
  ELSE
    v_amount := v_price;
  END IF;

  SELECT cv.club_id INTO v_club_id
  FROM public.club_venues cv WHERE cv.venue_id = v_venue_id LIMIT 1;

  IF p_period = 'season' THEN
    v_renews := COALESCE(v_tier.season_end, '9999-12-31'::date);
  ELSE
    v_renews := current_date + public._membership_period_interval(p_period);
  END IF;

  INSERT INTO public.venue_memberships (
    venue_id, tier_id, period, amount_pence, status, renews_at,
    club_id, member_profile_id, payer_profile_id, pricing_model
  ) VALUES (
    v_venue_id, p_tier_id, p_period, v_amount, 'active', v_renews,
    v_club_id, v_member_profile, v_payer_profile,
    CASE WHEN v_tier.pricing_model = 'season' THEN 'term' ELSE COALESCE(v_tier.pricing_model,'recurring') END
  )
  RETURNING id, pass_token INTO v_mid, v_pass_token;

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    v_venue_id, v_uid, 'player', 'member_self_enrolled',
    'venue_membership', v_mid::text,
    jsonb_build_object(
      'tier_id',           p_tier_id,
      'period',            p_period,
      'member_profile_id', v_member_profile,
      'payer_profile_id',  v_payer_profile,
      'club_id',           v_club_id,
      'full_price_pence',  v_price,
      'amount_pence',      v_amount,
      'proration_basis',   COALESCE(v_tier.proration_basis,'none'),
      'joining_fee_pence', COALESCE(v_tier.joining_fee_pence,0)
    )
  );

  RETURN jsonb_build_object(
    'ok',            true,
    'membership_id', v_mid,
    'amount_pence',  v_amount,
    'pass_token',    v_pass_token
  );
END;
$function$;

-- ─── coaching ───────────────────────────────────────────────────────────────────
-- 399_guards_coaching.sql
-- Feature-flag guards for the COACHING feature's write RPCs
-- (classes, trainers, PT appointments).
--
-- 'coaching' is a CLUB-owned feature. Each RPC gates on the UNION helper
--   public._venue_club_feature_enabled(<venue_id>, 'coaching')
-- which returns true when ANY club mapped to the venue has 'coaching' enabled
-- (and defaults to true for a club-less venue).
--
-- Venue-token RPCs resolve venue_id via resolve_venue_caller (v_caller.venue_id).
-- Member-facing RPCs derive venue_id from the booked resource row
-- (session / package / trainer / appointment).
--
-- DRAFT — guard-only change. Each function body below is byte-identical to the
-- live definition EXCEPT for the single inserted guard block, placed immediately
-- after venue_id is resolved/derived and known-valid, BEFORE any write.
-- Signature / RETURNS / volatility / SECURITY DEFINER / SET search_path /
-- LANGUAGE / $function$ tags preserved verbatim. GRANTs untouched.
--
-- venue_id is text throughout (venues.id, club_venues.venue_id, *.venue_id all text);
-- the helper's p_venue_id parameter is text, so no cast is required.

-- ============================================================================
-- VENUE-TOKEN RPCs (1–14) — venue_id via resolve_venue_caller
-- ============================================================================

-- 1. venue_create_class_type
CREATE OR REPLACE FUNCTION public.venue_create_class_type(p_venue_token text, p_name text, p_space_id uuid, p_duration_minutes integer, p_default_capacity integer, p_category text, p_cancellation_cutoff_hours integer DEFAULT 2, p_first_session_free boolean DEFAULT false, p_description text DEFAULT NULL::text, p_is_sparring boolean DEFAULT false, p_members_only boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
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
     default_capacity, cancellation_cutoff_hours, first_session_free, is_sparring, members_only)
  VALUES
    (v_caller.venue_id, p_space_id, btrim(p_name), p_description, p_category, p_duration_minutes,
     p_default_capacity, COALESCE(p_cancellation_cutoff_hours, 2), COALESCE(p_first_session_free, false),
     COALESCE(p_is_sparring, false), COALESCE(p_members_only, true))
  RETURNING id INTO v_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_type_created', 'venue_class_type', v_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'name', btrim(p_name), 'category', p_category,
                             'is_sparring', COALESCE(p_is_sparring, false),
                             'members_only', COALESCE(p_members_only, true)));
  RETURN jsonb_build_object('ok', true, 'class_type_id', v_id);
END;
$function$;

-- 2. venue_update_class_type
CREATE OR REPLACE FUNCTION public.venue_update_class_type(p_venue_token text, p_class_type_id uuid, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

-- 3. venue_schedule_class_session
CREATE OR REPLACE FUNCTION public.venue_schedule_class_session(p_venue_token text, p_class_type_id uuid, p_instructor_id uuid, p_starts_at timestamp with time zone, p_price_pence integer, p_payment_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_ct public.venue_class_types; v_ends timestamptz; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
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
$function$;

-- 4. venue_create_class_series
CREATE OR REPLACE FUNCTION public.venue_create_class_series(p_venue_token text, p_class_type_id uuid, p_instructor_id uuid, p_day_of_week smallint, p_start_time time without time zone, p_series_start date, p_price_pence integer, p_payment_mode text, p_series_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
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
  v_cursor := p_series_start + ((p_day_of_week - EXTRACT(DOW FROM p_series_start)::int + 7) % 7) * INTERVAL '1 day';
  WHILE v_cursor <= v_eff_end LOOP
    v_starts := (v_cursor + p_start_time) AT TIME ZONE 'Europe/London';
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
$function$;

-- 5. venue_cancel_class_session
CREATE OR REPLACE FUNCTION public.venue_cancel_class_session(p_venue_token text, p_session_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_sess public.venue_class_sessions; v_refunded int := 0; v_notified int := 0; v_credits int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'already', true, 'session_id', p_session_id); END IF;
  UPDATE public.venue_class_sessions SET status='cancelled', cancellation_reason=p_reason WHERE id=p_session_id;
  UPDATE public.venue_charges c SET status='refunded'
   WHERE c.source_type='class' AND c.status<>'refunded'
     AND c.source_id IN (SELECT b.id::text FROM public.venue_class_bookings b WHERE b.session_id = p_session_id);
  GET DIAGNOSTICS v_refunded = ROW_COUNT;
  UPDATE public.venue_member_package_balances bal SET sessions_remaining = sessions_remaining + 1
    FROM public.venue_class_bookings b
   WHERE b.session_id = p_session_id AND b.status IN ('confirmed','waitlist','offered') AND b.package_balance_id = bal.id;
  GET DIAGNOSTICS v_credits = ROW_COUNT;
  UPDATE public.venue_class_bookings b SET status='cancelled', cancelled_at=now(), package_balance_id=NULL
   WHERE b.session_id = p_session_id AND b.status IN ('confirmed','waitlist','offered');
  GET DIAGNOSTICS v_notified = ROW_COUNT;
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_caller.venue_id, b.member_profile_id::text, 'class_cancelled', p_session_id::text, mp.email, now(),
         jsonb_build_object('reason', p_reason)
    FROM public.venue_class_bookings b JOIN public.member_profiles mp ON mp.id = b.member_profile_id
   WHERE b.session_id = p_session_id AND b.status = 'cancelled';
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_session_cancelled', 'venue_class_session', p_session_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason, 'refunded', v_refunded,
                             'notified', v_notified, 'credits_restored', v_credits));
  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'refunded', v_refunded, 'notified', v_notified);
END; $function$;

-- 6. venue_cancel_class_series
CREATE OR REPLACE FUNCTION public.venue_cancel_class_series(p_venue_token text, p_series_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_cancelled int := 0; v_refunded int := 0; v_credits int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT ct.venue_id INTO v_venue_id FROM public.venue_class_series s
    JOIN public.venue_class_types ct ON ct.id = s.class_type_id WHERE s.id = p_series_id;
  IF v_venue_id IS NULL OR v_venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE='P0001'; END IF;
  UPDATE public.venue_charges c SET status='refunded'
   WHERE c.source_type='class' AND c.status<>'refunded'
     AND c.source_id IN (SELECT b.id::text FROM public.venue_class_bookings b
       JOIN public.venue_class_sessions cs ON cs.id = b.session_id
       WHERE cs.series_id = p_series_id AND cs.status='scheduled' AND cs.starts_at>now());
  GET DIAGNOSTICS v_refunded = ROW_COUNT;
  UPDATE public.venue_member_package_balances bal SET sessions_remaining = sessions_remaining + 1
    FROM public.venue_class_bookings b JOIN public.venue_class_sessions cs ON cs.id = b.session_id
   WHERE cs.series_id = p_series_id AND cs.status='scheduled' AND cs.starts_at>now()
     AND b.status IN ('confirmed','waitlist','offered') AND b.package_balance_id = bal.id;
  GET DIAGNOSTICS v_credits = ROW_COUNT;
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_caller.venue_id, b.member_profile_id::text, 'class_cancelled', cs.id::text, mp.email, now(),
         jsonb_build_object('reason', p_reason, 'series_id', p_series_id)
    FROM public.venue_class_bookings b JOIN public.venue_class_sessions cs ON cs.id = b.session_id
    JOIN public.member_profiles mp ON mp.id = b.member_profile_id
   WHERE cs.series_id = p_series_id AND cs.status='scheduled' AND cs.starts_at>now() AND b.status IN ('confirmed','waitlist','offered');
  UPDATE public.venue_class_bookings b SET status='cancelled', cancelled_at=now(), package_balance_id=NULL
   WHERE b.status IN ('confirmed','waitlist','offered')
     AND b.session_id IN (SELECT cs.id FROM public.venue_class_sessions cs
       WHERE cs.series_id = p_series_id AND cs.status='scheduled' AND cs.starts_at>now());
  UPDATE public.venue_class_sessions SET status='cancelled', cancellation_reason=p_reason
   WHERE series_id = p_series_id AND status='scheduled' AND starts_at>now();
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  UPDATE public.venue_class_series SET is_active = false WHERE id = p_series_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_series_cancelled', 'venue_class_series', p_series_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'reason', p_reason, 'sessions_cancelled', v_cancelled,
                             'refunded', v_refunded, 'credits_restored', v_credits));
  RETURN jsonb_build_object('ok', true, 'series_id', p_series_id, 'sessions_cancelled', v_cancelled, 'refunded', v_refunded);
END; $function$;

-- 7. venue_reassign_class_instructor
CREATE OR REPLACE FUNCTION public.venue_reassign_class_instructor(p_venue_token text, p_session_id uuid, p_new_instructor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_sess public.venue_class_sessions;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' THEN RAISE EXCEPTION 'session_not_scheduled' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_admins WHERE id = p_new_instructor_id AND venue_id = v_caller.venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'instructor_not_found' USING ERRCODE='P0001';
  END IF;
  UPDATE public.venue_class_sessions SET instructor_id = p_new_instructor_id WHERE id = p_session_id;
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
$function$;

-- 8. venue_mark_class_completed
CREATE OR REPLACE FUNCTION public.venue_mark_class_completed(p_venue_token text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
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
$function$;

-- 9. venue_create_class_package
CREATE OR REPLACE FUNCTION public.venue_create_class_package(p_venue_token text, p_name text, p_session_count integer, p_price_pence integer, p_valid_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'name_required' USING ERRCODE='P0001'; END IF;
  IF p_session_count IS NULL OR p_session_count <= 0 THEN RAISE EXCEPTION 'bad_session_count' USING ERRCODE='P0001'; END IF;
  IF p_price_pence IS NULL OR p_price_pence < 0 THEN RAISE EXCEPTION 'bad_price' USING ERRCODE='P0001'; END IF;
  IF p_valid_days IS NOT NULL AND p_valid_days <= 0 THEN RAISE EXCEPTION 'bad_valid_days' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.venue_class_packages (venue_id, name, session_count, price_pence, valid_days)
  VALUES (v_caller.venue_id, btrim(p_name), p_session_count, p_price_pence, p_valid_days)
  RETURNING id INTO v_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
     'venue_class_package_created', 'venue_class_package', v_id::text,
     jsonb_build_object('venue_id', v_caller.venue_id, 'name', btrim(p_name), 'session_count', p_session_count,
                        'price_pence', p_price_pence, 'valid_days', p_valid_days));
  RETURN jsonb_build_object('ok', true, 'package_id', v_id);
END; $function$;

-- 10. venue_class_checkin
CREATE OR REPLACE FUNCTION public.venue_class_checkin(p_venue_token text, p_session_id uuid, p_pass_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     record;
  v_sess       public.venue_class_sessions;
  v_is_manager boolean;
  v_admin_id   uuid;
  v_token      text;
  v_mp_id      uuid;
  v_mp_venue   text;
  v_member_nm  text;
  v_bk         public.venue_class_bookings;
  v_promoted   boolean := false;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.venue_id <> v_caller.venue_id THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_sess.status = 'cancelled' THEN RAISE EXCEPTION 'session_cancelled' USING ERRCODE='P0001'; END IF;
  IF v_sess.status = 'completed' THEN RAISE EXCEPTION 'session_completed' USING ERRCODE='P0001'; END IF;

  v_is_manager := v_caller.actor_type = 'platform_admin'
               OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility');
  IF NOT v_is_manager THEN
    SELECT id INTO v_admin_id
      FROM public.venue_admins
     WHERE user_id = auth.uid() AND venue_id = v_caller.venue_id
       AND status = 'active' AND revoked_at IS NULL
     LIMIT 1;
    IF v_admin_id IS NULL OR v_admin_id <> v_sess.instructor_id THEN
      RAISE EXCEPTION 'not_instructor' USING ERRCODE='P0001';
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

  SELECT * INTO v_bk FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_mp_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_booked', 'member_name', v_member_nm);
  END IF;
  IF v_bk.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_cancelled', 'member_name', v_member_nm);
  END IF;
  IF v_bk.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_checked_in', true,
                              'member_name', v_member_nm, 'status', v_bk.status);
  END IF;

  v_promoted := v_bk.status <> 'confirmed';

  UPDATE public.venue_class_bookings
     SET status = 'confirmed', checked_in_at = now(),
         waitlist_position = NULL, offer_expires_at = NULL
   WHERE id = v_bk.id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_class_checkin', 'venue_class_booking', v_bk.id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'session_id', p_session_id::text,
                             'member_profile_id', v_mp_id::text, 'promoted', v_promoted, 'via', 'qr'));

  RETURN jsonb_build_object('ok', true, 'already_checked_in', false,
                            'member_name', v_member_nm, 'status', 'confirmed', 'promoted', v_promoted);
END;
$function$;

-- 11. venue_upsert_trainer
CREATE OR REPLACE FUNCTION public.venue_upsert_trainer(p_venue_token text, p_trainer_id uuid DEFAULT NULL::uuid, p_display_name text DEFAULT NULL::text, p_bio text DEFAULT NULL::text, p_admin_id uuid DEFAULT NULL::uuid, p_default_session_minutes integer DEFAULT 60, p_price_pence integer DEFAULT 0, p_cancel_cutoff_hours integer DEFAULT 0, p_members_only boolean DEFAULT true, p_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF p_trainer_id IS NULL AND (p_display_name IS NULL OR length(btrim(p_display_name)) = 0) THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(p_default_session_minutes, 60) <= 0 THEN RAISE EXCEPTION 'invalid_session_minutes' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(p_price_pence, 0) < 0 OR COALESCE(p_cancel_cutoff_hours, 0) < 0 THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001'; END IF;
  IF p_admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.venue_admins WHERE id = p_admin_id AND venue_id = v_venue_id) THEN
    RAISE EXCEPTION 'admin_not_in_venue' USING ERRCODE = 'P0001'; END IF;
  IF p_trainer_id IS NULL THEN
    INSERT INTO public.venue_trainers (venue_id, admin_id, display_name, bio, default_session_minutes, price_pence, cancel_cutoff_hours, members_only, active)
    VALUES (v_venue_id, p_admin_id, btrim(p_display_name), NULLIF(btrim(COALESCE(p_bio,'')),''), COALESCE(p_default_session_minutes,60), COALESCE(p_price_pence,0), COALESCE(p_cancel_cutoff_hours,0), COALESCE(p_members_only,true), COALESCE(p_active,true))
    RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.venue_trainers WHERE id = p_trainer_id AND venue_id = v_venue_id) THEN RAISE EXCEPTION 'trainer_not_found' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.venue_trainers SET admin_id = p_admin_id,
      display_name = COALESCE(NULLIF(btrim(COALESCE(p_display_name,'')),''), display_name),
      bio = NULLIF(btrim(COALESCE(p_bio,'')),''),
      default_session_minutes = COALESCE(p_default_session_minutes, default_session_minutes),
      price_pence = COALESCE(p_price_pence, price_pence),
      cancel_cutoff_hours = COALESCE(p_cancel_cutoff_hours, cancel_cutoff_hours),
      members_only = COALESCE(p_members_only, members_only),
      active = COALESCE(p_active, active)
    WHERE id = p_trainer_id RETURNING id INTO v_id;
  END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          CASE WHEN p_trainer_id IS NULL THEN 'trainer_created' ELSE 'trainer_updated' END,
          'venue_trainer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'admin_id', p_admin_id, 'members_only', COALESCE(p_members_only,true), 'price_pence', COALESCE(p_price_pence,0), 'active', COALESCE(p_active,true)));
  RETURN jsonb_build_object('ok', true, 'trainer_id', v_id);
END;
$function$;

-- 12. venue_set_trainer_availability
CREATE OR REPLACE FUNCTION public.venue_set_trainer_availability(p_venue_token text, p_trainer_id uuid, p_windows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_w jsonb; v_count int := 0;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_trainers WHERE id = p_trainer_id AND venue_id = v_venue_id) THEN RAISE EXCEPTION 'trainer_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_windows IS NULL OR jsonb_typeof(p_windows) <> 'array' THEN RAISE EXCEPTION 'windows_required' USING ERRCODE = 'P0001'; END IF;
  DELETE FROM public.venue_trainer_availability WHERE trainer_id = p_trainer_id;
  FOR v_w IN SELECT * FROM jsonb_array_elements(p_windows) LOOP
    INSERT INTO public.venue_trainer_availability (trainer_id, day_of_week, start_time, end_time, slot_minutes, series_start, series_end)
    VALUES (p_trainer_id, (v_w->>'day_of_week')::smallint, (v_w->>'start_time')::time, (v_w->>'end_time')::time,
            COALESCE((v_w->>'slot_minutes')::int, 60), COALESCE((v_w->>'series_start')::date, current_date), NULLIF(v_w->>'series_end','')::date);
    v_count := v_count + 1;
  END LOOP;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'trainer_availability_set', 'venue_trainer', p_trainer_id::text, jsonb_build_object('venue_id', v_venue_id, 'windows', v_count));
  RETURN jsonb_build_object('ok', true, 'trainer_id', p_trainer_id, 'windows', v_count);
END;
$function$;

-- 13. venue_mark_appointment_completed
CREATE OR REPLACE FUNCTION public.venue_mark_appointment_completed(p_venue_token text, p_appointment_id uuid, p_no_show boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_ap public.venue_appointments; v_tr public.venue_trainers; v_is_manager boolean;
  v_admin_id uuid; v_new_status text; v_no_show int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ap FROM public.venue_appointments WHERE id = p_appointment_id;
  IF NOT FOUND OR v_ap.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'appointment_not_found' USING ERRCODE='P0001'; END IF;
  IF v_ap.status <> 'confirmed' THEN RAISE EXCEPTION 'not_completable' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_tr FROM public.venue_trainers WHERE id = v_ap.trainer_id;
  v_is_manager := v_caller.actor_type = 'platform_admin' OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility');
  IF NOT v_is_manager THEN
    SELECT id INTO v_admin_id FROM public.venue_admins WHERE user_id = auth.uid() AND venue_id = v_caller.venue_id AND status = 'active' AND revoked_at IS NULL LIMIT 1;
    IF v_admin_id IS NULL OR v_tr.admin_id IS NULL OR v_admin_id <> v_tr.admin_id THEN RAISE EXCEPTION 'not_trainer' USING ERRCODE='P0001'; END IF;
  END IF;
  IF COALESCE(p_no_show, false) THEN
    v_new_status := 'no_show';
    UPDATE public.member_profiles SET no_show_count = no_show_count + 1 WHERE id = v_ap.member_profile_id RETURNING no_show_count INTO v_no_show;
  ELSE
    v_new_status := 'completed';
  END IF;
  UPDATE public.venue_appointments SET status = v_new_status WHERE id = p_appointment_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_appointment_completed', 'venue_appointment', p_appointment_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'trainer_id', v_ap.trainer_id, 'member_profile_id', v_ap.member_profile_id, 'status', v_new_status, 'no_show_count', v_no_show));
  RETURN jsonb_build_object('ok', true, 'appointment_id', p_appointment_id, 'status', v_new_status, 'no_show_count', v_no_show);
END;
$function$;

-- 14. venue_pt_checkin
CREATE OR REPLACE FUNCTION public.venue_pt_checkin(p_venue_token text, p_appointment_id uuid, p_pass_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_ap public.venue_appointments; v_tr public.venue_trainers; v_is_manager boolean;
  v_admin_id uuid; v_token text; v_mp_id uuid; v_mp_venue text; v_member_nm text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_caller.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ap FROM public.venue_appointments WHERE id = p_appointment_id;
  IF NOT FOUND OR v_ap.venue_id <> v_caller.venue_id THEN RAISE EXCEPTION 'appointment_not_found' USING ERRCODE='P0001'; END IF;
  IF v_ap.status = 'cancelled' THEN RAISE EXCEPTION 'appointment_cancelled' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_tr FROM public.venue_trainers WHERE id = v_ap.trainer_id;
  v_is_manager := v_caller.actor_type = 'platform_admin' OR public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility');
  IF NOT v_is_manager THEN
    SELECT id INTO v_admin_id FROM public.venue_admins WHERE user_id = auth.uid() AND venue_id = v_caller.venue_id AND status = 'active' AND revoked_at IS NULL LIMIT 1;
    IF v_admin_id IS NULL OR v_tr.admin_id IS NULL OR v_admin_id <> v_tr.admin_id THEN RAISE EXCEPTION 'not_trainer' USING ERRCODE='P0001'; END IF;
  END IF;
  v_token := regexp_replace(COALESCE(p_pass_token, ''), '^.*/m/', '');
  v_token := split_part(v_token, '?', 1);
  v_token := btrim(v_token);
  IF v_token = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_token'); END IF;
  SELECT member_profile_id, venue_id INTO v_mp_id, v_mp_venue FROM public.venue_memberships WHERE pass_token = v_token LIMIT 1;
  IF v_mp_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'pass_not_found'); END IF;
  IF v_mp_venue <> v_caller.venue_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_venue'); END IF;
  SELECT btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) INTO v_member_nm FROM public.member_profiles WHERE id = v_mp_id;
  IF v_ap.member_profile_id <> v_mp_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_member', 'member_name', v_member_nm); END IF;
  IF v_ap.checked_in_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_checked_in', true, 'member_name', v_member_nm); END IF;
  UPDATE public.venue_appointments SET checked_in_at = now() WHERE id = p_appointment_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_caller.venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident, 'venue_pt_checkin', 'venue_appointment', p_appointment_id::text,
          jsonb_build_object('venue_id', v_caller.venue_id, 'trainer_id', v_ap.trainer_id, 'member_profile_id', v_mp_id, 'via', 'qr'));
  RETURN jsonb_build_object('ok', true, 'already_checked_in', false, 'member_name', v_member_nm);
END;
$function$;

-- ============================================================================
-- MEMBER-FACING RPCs (15–20) — venue_id derived from the booked resource row
-- ============================================================================

-- 15. member_book_class_session  (venue_id = v_sess.venue_id)
CREATE OR REPLACE FUNCTION public.member_book_class_session(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   public.member_profiles;
  v_sess      public.venue_class_sessions;
  v_members_only boolean;
  v_threshold int;
  v_occupied  int;
  v_existing  public.venue_class_bookings;
  v_status    text;
  v_wpos      int;
  v_booking_id uuid;
  v_connected boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE='P0001'; END IF;
  IF v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RAISE EXCEPTION 'session_not_bookable' USING ERRCODE='P0001';
  END IF;
  IF NOT public._venue_club_feature_enabled(v_sess.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  -- members_only lever (per class type; default true). An ACCOUNT is always required
  -- (enforced above); a paid MEMBERSHIP is required only when the type is members_only.
  SELECT members_only INTO v_members_only FROM public.venue_class_types WHERE id = v_sess.class_type_id;
  IF COALESCE(v_members_only, true) THEN
    IF NOT EXISTS (SELECT 1 FROM public.venue_memberships
                    WHERE member_profile_id = v_profile.id AND venue_id = v_sess.venue_id
                      AND status IN ('active','ending')) THEN
      RAISE EXCEPTION 'membership_required' USING ERRCODE='P0001';
    END IF;
  END IF;

  SELECT no_show_suspension_threshold INTO v_threshold FROM public.venues WHERE id = v_sess.venue_id;
  IF v_threshold IS NOT NULL AND v_profile.no_show_count >= v_threshold THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suspended', 'no_show_count', v_profile.no_show_count);
  END IF;

  IF v_sess.payment_mode = 'prepay' THEN
    SELECT EXISTS (SELECT 1 FROM public.venue_integrations
                    WHERE venue_id = v_sess.venue_id AND provider = 'stripe' AND status = 'connected')
      INTO v_connected;
    IF NOT v_connected THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'payment_method_unavailable');
    END IF;
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_profile.id;
  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed','waitlist','offered') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_booked',
                              'booking_id', v_existing.id, 'status', v_existing.status);
  END IF;

  SELECT count(*) INTO v_occupied FROM public.venue_class_bookings
   WHERE session_id = p_session_id
     AND (status = 'confirmed'
          OR (status = 'offered' AND offer_expires_at > now()));
  IF v_sess.capacity > 0 AND v_occupied < v_sess.capacity THEN
    v_status := 'confirmed'; v_wpos := NULL;
  ELSE
    v_status := 'waitlist';
    SELECT COALESCE(max(waitlist_position), 0) + 1 INTO v_wpos
      FROM public.venue_class_bookings WHERE session_id = p_session_id AND status = 'waitlist';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.venue_class_bookings
       SET status = v_status, waitlist_position = v_wpos, booked_at = now(),
           cancelled_at = NULL, offer_expires_at = NULL,
           payment_status = 'pending', payment_method = 'not_yet'
     WHERE id = v_existing.id
     RETURNING id INTO v_booking_id;
  ELSE
    INSERT INTO public.venue_class_bookings (session_id, member_profile_id, status, waitlist_position)
    VALUES (p_session_id, v_profile.id, v_status, v_wpos)
    RETURNING id INTO v_booking_id;
  END IF;

  IF v_status = 'confirmed' THEN
    PERFORM public._apply_class_booking_charge(v_booking_id);
  END IF;

  SELECT * INTO v_existing FROM public.venue_class_bookings WHERE id = v_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_sess.venue_id, v_uid, 'player', 'member_class_booked', 'venue_class_booking', v_booking_id::text,
          jsonb_build_object('session_id', p_session_id, 'status', v_status,
                             'member_profile_id', v_profile.id, 'waitlist_position', v_wpos));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', v_status,
                            'payment_status', v_existing.payment_status,
                            'payment_method', v_existing.payment_method,
                            'waitlist_position', v_wpos);
END;
$function$;

-- 16. member_cancel_class_booking  (venue_id = v_venue_id := v_sess.venue_id)
CREATE OR REPLACE FUNCTION public.member_cancel_class_booking(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid; v_bk public.venue_class_bookings; v_sess public.venue_class_sessions;
  v_ct public.venue_class_types; v_venue_id text; v_was text; v_refunded int := 0; v_offered uuid;
  v_frees_seat boolean; v_credit_restored boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_bk FROM public.venue_class_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_bk.member_profile_id <> v_profile_id THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE='P0001'; END IF;
  IF v_bk.status NOT IN ('confirmed','waitlist','offered') THEN RAISE EXCEPTION 'not_cancellable' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = v_bk.session_id;
  SELECT * INTO v_ct   FROM public.venue_class_types    WHERE id = v_sess.class_type_id;
  v_venue_id := v_sess.venue_id; v_was := v_bk.status;
  IF NOT public._venue_club_feature_enabled(v_venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_was = 'confirmed' AND now() > v_sess.starts_at - (v_ct.cancellation_cutoff_hours * INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'cutoff_passed' USING ERRCODE='P0001';
  END IF;
  v_frees_seat := (v_was = 'confirmed') OR (v_was = 'offered' AND v_bk.offer_expires_at IS NOT NULL AND v_bk.offer_expires_at > now());
  IF v_bk.package_balance_id IS NOT NULL THEN
    UPDATE public.venue_member_package_balances SET sessions_remaining = sessions_remaining + 1 WHERE id = v_bk.package_balance_id;
    v_credit_restored := true;
  END IF;
  UPDATE public.venue_class_bookings SET status='cancelled', cancelled_at=now(), waitlist_position=NULL, offer_expires_at=NULL, package_balance_id=NULL WHERE id=p_booking_id;
  UPDATE public.venue_charges SET status='refunded' WHERE source_type='class' AND source_id=p_booking_id::text AND status<>'refunded';
  GET DIAGNOSTICS v_refunded = ROW_COUNT;
  IF v_frees_seat AND v_sess.status='scheduled' AND v_sess.starts_at>now() THEN
    v_offered := public._offer_next_waitlist_spot(v_bk.session_id);
  END IF;
  INSERT INTO public.notification_log (team_id, player_id, type, entity_id, recipient, queued_for, queued_payload)
  SELECT v_venue_id, v_profile_id::text, 'class_booking_cancelled', p_booking_id::text, mp.email, now(),
         jsonb_build_object('session_id', v_bk.session_id) FROM public.member_profiles mp WHERE mp.id = v_profile_id;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, v_uid, 'player', 'member_class_cancelled', 'venue_class_booking', p_booking_id::text,
          jsonb_build_object('session_id', v_bk.session_id, 'was', v_was, 'refunded', v_refunded,
                             'offered', v_offered, 'credit_restored', v_credit_restored));
  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'refunded', v_refunded,
                            'offered', (v_offered IS NOT NULL), 'credit_restored', v_credit_restored);
END; $function$;

-- 17. member_claim_waitlist_spot  (venue_id = v_sess.venue_id)
CREATE OR REPLACE FUNCTION public.member_claim_waitlist_spot(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_bk         public.venue_class_bookings;
  v_sess       public.venue_class_sessions;
  v_confirmed  int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_bk FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND member_profile_id = v_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spot_taken');
  END IF;

  IF v_bk.status <> 'offered' OR v_bk.offer_expires_at IS NULL OR v_bk.offer_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spot_taken');
  END IF;

  SELECT * INTO v_sess FROM public.venue_class_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.status <> 'scheduled' OR v_sess.starts_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spot_taken');
  END IF;
  IF NOT public._venue_club_feature_enabled(v_sess.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_confirmed FROM public.venue_class_bookings
   WHERE session_id = p_session_id AND status = 'confirmed' AND id <> v_bk.id;
  IF v_sess.capacity > 0 AND v_confirmed >= v_sess.capacity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'spot_taken');
  END IF;

  UPDATE public.venue_class_bookings
     SET status = 'confirmed', waitlist_position = NULL, offer_expires_at = NULL, booked_at = now()
   WHERE id = v_bk.id;

  PERFORM public._apply_class_booking_charge(v_bk.id);
  SELECT * INTO v_bk FROM public.venue_class_bookings WHERE id = v_bk.id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_sess.venue_id, v_uid, 'player', 'member_class_claimed', 'venue_class_booking', v_bk.id::text,
          jsonb_build_object('session_id', p_session_id, 'member_profile_id', v_profile_id));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_bk.id, 'status', 'confirmed',
                            'payment_status', v_bk.payment_status, 'payment_method', v_bk.payment_method);
END;
$function$;

-- 18. member_purchase_class_package  (venue_id = v_pkg.venue_id)
CREATE OR REPLACE FUNCTION public.member_purchase_class_package(p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile_id uuid; v_pkg public.venue_class_packages; v_expires timestamptz; v_balance_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_pkg FROM public.venue_class_packages WHERE id = p_package_id;
  IF NOT FOUND OR v_pkg.is_active = false THEN RAISE EXCEPTION 'package_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_pkg.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_memberships
                  WHERE member_profile_id = v_profile_id AND venue_id = v_pkg.venue_id AND status IN ('active','ending')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'membership_required');
  END IF;
  IF v_pkg.valid_days IS NOT NULL THEN v_expires := now() + (v_pkg.valid_days * INTERVAL '1 day'); END IF;
  INSERT INTO public.venue_member_package_balances (member_profile_id, package_id, venue_id, sessions_remaining, purchased_at, expires_at)
  VALUES (v_profile_id, v_pkg.id, v_pkg.venue_id, v_pkg.session_count, now(), v_expires)
  RETURNING id INTO v_balance_id;
  IF v_pkg.price_pence > 0 THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_pkg.venue_id, 'class_package', v_balance_id::text, v_pkg.price_pence, 'unpaid', now()::date);
  END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_pkg.venue_id, v_uid, 'player', 'member_class_package_purchased', 'venue_member_package_balance', v_balance_id::text,
          jsonb_build_object('package_id', v_pkg.id, 'member_profile_id', v_profile_id, 'sessions', v_pkg.session_count,
                             'price_pence', v_pkg.price_pence, 'expires_at', v_expires));
  RETURN jsonb_build_object('ok', true, 'balance_id', v_balance_id, 'package_id', v_pkg.id,
                            'sessions_remaining', v_pkg.session_count, 'expires_at', v_expires, 'charge_pence', v_pkg.price_pence);
END; $function$;

-- 19. member_book_appointment  (venue_id = v_tr.venue_id)
CREATE OR REPLACE FUNCTION public.member_book_appointment(p_trainer_id uuid, p_starts_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile public.member_profiles; v_tr public.venue_trainers;
  v_local_d date; v_local_t time; v_w record; v_slot_min int; v_ends timestamptz; v_member boolean;
  v_threshold int; v_appt_id uuid; v_charge_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_tr FROM public.venue_trainers WHERE id = p_trainer_id AND active;
  IF v_tr.id IS NULL THEN RAISE EXCEPTION 'trainer_not_found' USING ERRCODE='P0001'; END IF;
  IF p_starts_at IS NULL OR p_starts_at <= now() THEN RAISE EXCEPTION 'slot_in_past' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_tr.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.venue_memberships WHERE member_profile_id = v_profile.id AND venue_id = v_tr.venue_id AND status IN ('active','ending')) INTO v_member;
  IF v_tr.members_only AND NOT v_member THEN RAISE EXCEPTION 'membership_required' USING ERRCODE='P0001'; END IF;
  SELECT no_show_suspension_threshold INTO v_threshold FROM public.venues WHERE id = v_tr.venue_id;
  IF v_threshold IS NOT NULL AND v_profile.no_show_count >= v_threshold THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suspended', 'no_show_count', v_profile.no_show_count); END IF;
  v_local_d := (p_starts_at AT TIME ZONE 'Europe/London')::date;
  v_local_t := (p_starts_at AT TIME ZONE 'Europe/London')::time;
  SELECT * INTO v_w FROM public.venue_trainer_availability av
   WHERE av.trainer_id = p_trainer_id AND av.is_active AND av.day_of_week = EXTRACT(DOW FROM v_local_d)::int
     AND v_local_d >= av.series_start AND (av.series_end IS NULL OR v_local_d <= av.series_end)
     AND v_local_t >= av.start_time AND v_local_t + (av.slot_minutes * INTERVAL '1 minute') <= av.end_time
     AND mod(EXTRACT(EPOCH FROM (v_local_t - av.start_time))::int, av.slot_minutes * 60) = 0
   ORDER BY av.start_time LIMIT 1;
  IF v_w.id IS NULL THEN RAISE EXCEPTION 'not_a_valid_slot' USING ERRCODE='P0001'; END IF;
  v_slot_min := v_w.slot_minutes;
  v_ends := p_starts_at + (v_slot_min * INTERVAL '1 minute');
  BEGIN
    INSERT INTO public.venue_appointments (venue_id, trainer_id, member_profile_id, starts_at, ends_at, status, price_pence, payment_mode)
    VALUES (v_tr.venue_id, p_trainer_id, v_profile.id, p_starts_at, v_ends, 'confirmed', v_tr.price_pence, 'door')
    RETURNING id INTO v_appt_id;
  EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok', false, 'reason', 'slot_taken'); END;
  IF v_tr.price_pence > 0 THEN
    INSERT INTO public.venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES (v_tr.venue_id, 'pt', v_appt_id::text, v_tr.price_pence, 'unpaid', p_starts_at::date) RETURNING id INTO v_charge_id;
    UPDATE public.venue_appointments SET charge_id = v_charge_id WHERE id = v_appt_id;
  END IF;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_tr.venue_id, v_uid, 'player', 'member_appointment_booked', 'venue_appointment', v_appt_id::text,
          jsonb_build_object('trainer_id', p_trainer_id, 'member_profile_id', v_profile.id, 'starts_at', p_starts_at, 'price_pence', v_tr.price_pence, 'charge_id', v_charge_id, 'members_only', v_tr.members_only));
  RETURN jsonb_build_object('ok', true, 'appointment_id', v_appt_id, 'status', 'confirmed', 'starts_at', p_starts_at, 'ends_at', v_ends, 'price_pence', v_tr.price_pence, 'charge_id', v_charge_id);
END;
$function$;

-- 20. member_cancel_appointment  (venue_id = v_ap.venue_id)
CREATE OR REPLACE FUNCTION public.member_cancel_appointment(p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_profile uuid; v_ap public.venue_appointments; v_cutoff int; v_refunded int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_ap FROM public.venue_appointments WHERE id = p_appointment_id;
  IF v_ap.id IS NULL OR v_ap.member_profile_id <> v_profile THEN RAISE EXCEPTION 'appointment_not_found' USING ERRCODE='P0001'; END IF;
  IF v_ap.status <> 'confirmed' THEN RAISE EXCEPTION 'not_cancellable' USING ERRCODE='P0001'; END IF;
  IF NOT public._venue_club_feature_enabled(v_ap.venue_id, 'coaching') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT cancel_cutoff_hours INTO v_cutoff FROM public.venue_trainers WHERE id = v_ap.trainer_id;
  IF COALESCE(v_cutoff,0) > 0 AND now() > v_ap.starts_at - (v_cutoff * INTERVAL '1 hour') THEN RAISE EXCEPTION 'cutoff_passed' USING ERRCODE='P0001'; END IF;
  UPDATE public.venue_appointments SET status = 'cancelled' WHERE id = p_appointment_id;
  UPDATE public.venue_charges SET status = 'refunded' WHERE source_type = 'pt' AND source_id = p_appointment_id::text AND status <> 'refunded';
  GET DIAGNOSTICS v_refunded = ROW_COUNT;
  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES (v_ap.venue_id, v_uid, 'player', 'member_appointment_cancelled', 'venue_appointment', p_appointment_id::text,
          jsonb_build_object('trainer_id', v_ap.trainer_id, 'member_profile_id', v_profile, 'starts_at', v_ap.starts_at, 'refunded', v_refunded));
  RETURN jsonb_build_object('ok', true, 'appointment_id', p_appointment_id, 'refunded', v_refunded);
END;
$function$;

-- ─── competition ───────────────────────────────────────────────────────────────────
-- 399_guards_competition.sql
-- DRAFT — feature-flag guards for the COMPETITION feature's write RPCs (club leagues + fixtures).
--
-- 'competition' is a CLUB-owned feature.
--   * Where a club_id is in scope, gate directly:  public._club_feature_enabled(<club_id>, 'competition')
--   * Where only a venue_id is in scope (no league/club), gate on the union:
--                                                public._venue_club_feature_enabled(<venue_id>, 'competition')
--
-- Each function below is byte-identical to the live body EXCEPT for the single guard
-- block added immediately after the relevant id is resolved/known-valid and BEFORE any
-- write. Signatures, RETURNS, volatility, SECURITY DEFINER, SET search_path, LANGUAGE
-- and $function$ tags are preserved verbatim. GRANTs are untouched.
--
-- Guard shape:
--   IF NOT public.<helper>(<id_expr>, 'competition') THEN
--     RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
--   END IF;
--
-- DRAFT ONLY — not applied. No DDL run by the drafter.


-- ============================================================================
-- 1. venue_create_club_league — p_club_id known directly.
--    Guard: _club_feature_enabled(p_club_id, ...) after club_not_found, before INSERT.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.venue_create_club_league(p_venue_token text, p_club_id text, p_name text, p_season_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  record;
  v_venue   text;
  v_id      uuid;
  v_name    text := NULLIF(btrim(p_name), '');
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(p_club_id, 'competition') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.club_leagues (club_id, venue_id, name, season_label)
  VALUES (p_club_id, v_venue, v_name, NULLIF(btrim(p_season_label), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_league_created', 'club_league', v_id::text,
          jsonb_build_object('club_id', p_club_id, 'name', v_name));
  RETURN jsonb_build_object('ok', true, 'league_id', v_id);
END;
$function$;


-- ============================================================================
-- 2. venue_update_club_league — club_id from the league row.
--    Live body only does an EXISTS check (no club_id var); guard resolves
--    club_id via scalar subquery, after league_not_found, before UPDATE.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.venue_update_club_league(p_venue_token text, p_league_id uuid, p_name text DEFAULT NULL::text, p_season_label text DEFAULT NULL::text, p_archived boolean DEFAULT NULL::boolean, p_fa_embed_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_leagues WHERE id = p_league_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(
       (SELECT club_id FROM public.club_leagues WHERE id = p_league_id AND venue_id = v_venue),
       'competition') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.club_leagues SET
    name          = COALESCE(NULLIF(btrim(p_name), ''), name),
    season_label  = COALESCE(NULLIF(btrim(p_season_label), ''), season_label),
    archived_at   = CASE WHEN p_archived IS NULL THEN archived_at
                         WHEN p_archived THEN COALESCE(archived_at, now())
                         ELSE NULL END,
    fa_embed_code = CASE WHEN p_fa_embed_code IS NULL THEN fa_embed_code
                         WHEN btrim(p_fa_embed_code) = '' THEN NULL
                         ELSE p_fa_embed_code END
  WHERE id = p_league_id AND venue_id = v_venue;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_league_updated', 'club_league', p_league_id::text,
          jsonb_build_object('archived', p_archived, 'fa_snippet_set', p_fa_embed_code IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'league_id', p_league_id);
END;
$function$;


-- ============================================================================
-- 3. venue_upsert_club_fixture — two branches, each loads v_league.club_id.
--    INSERT branch: guard after v_league resolved (id NOT NULL), before INSERT.
--    UPDATE branch: guard after v_league resolved (id NOT NULL), before UPDATE.
--    id_expr = v_league.club_id in both branches.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.venue_upsert_club_fixture(p_venue_token text, p_fixture_id uuid DEFAULT NULL::uuid, p_league_id uuid DEFAULT NULL::uuid, p_club_team_id uuid DEFAULT NULL::uuid, p_club_team_name text DEFAULT NULL::text, p_opponent_name text DEFAULT NULL::text, p_is_home boolean DEFAULT NULL::boolean, p_scheduled_date date DEFAULT NULL::date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone, p_playing_area_id uuid DEFAULT NULL::uuid, p_official_id uuid DEFAULT NULL::uuid, p_ref_name text DEFAULT NULL::text, p_home_score integer DEFAULT NULL::integer, p_away_score integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
  v_league record;
  v_id     uuid;
  v_code   text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('scheduled','completed','postponed','void') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;
  IF p_playing_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.playing_areas WHERE id = p_playing_area_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  IF p_official_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.match_officials WHERE id = p_official_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'ref_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  IF p_fixture_id IS NULL THEN
    IF p_league_id IS NULL THEN RAISE EXCEPTION 'league_required' USING ERRCODE = 'P0001'; END IF;
    IF NULLIF(btrim(p_opponent_name), '') IS NULL THEN
      RAISE EXCEPTION 'opponent_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT cl.id, cl.club_id INTO v_league
      FROM public.club_leagues cl WHERE cl.id = p_league_id AND cl.venue_id = v_venue;
    IF v_league.id IS NULL THEN RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001'; END IF;

    IF NOT public._club_feature_enabled(v_league.club_id, 'competition') THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
    END IF;

    IF p_club_team_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.club_teams WHERE id = p_club_team_id AND club_id = v_league.club_id) THEN
      RAISE EXCEPTION 'team_not_in_club' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.club_fixtures (
      league_id, club_team_id, club_team_name, opponent_name, is_home,
      scheduled_date, kickoff_time, playing_area_id, official_id, ref_name,
      home_score, away_score, status, notes)
    VALUES (
      p_league_id, p_club_team_id, NULLIF(btrim(p_club_team_name), ''),
      btrim(p_opponent_name), COALESCE(p_is_home, true),
      p_scheduled_date, p_kickoff_time, p_playing_area_id, p_official_id, NULLIF(btrim(p_ref_name), ''),
      p_home_score, p_away_score, COALESCE(p_status, 'scheduled'), NULLIF(btrim(p_notes), ''))
    RETURNING id, share_code INTO v_id, v_code;

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'club_fixture_created', 'club_fixture', v_id::text,
            jsonb_build_object('league_id', p_league_id, 'opponent', btrim(p_opponent_name)));
    RETURN jsonb_build_object('ok', true, 'fixture_id', v_id, 'share_code', v_code, 'created', true);
  ELSE
    SELECT f.id, f.share_code, cl.club_id INTO v_league
      FROM public.club_fixtures f
      JOIN public.club_leagues cl ON cl.id = f.league_id
      WHERE f.id = p_fixture_id AND cl.venue_id = v_venue;
    IF v_league.id IS NULL THEN RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001'; END IF;

    IF NOT public._club_feature_enabled(v_league.club_id, 'competition') THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
    END IF;

    IF p_club_team_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.club_teams WHERE id = p_club_team_id AND club_id = v_league.club_id) THEN
      RAISE EXCEPTION 'team_not_in_club' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.club_fixtures SET
      club_team_id    = COALESCE(p_club_team_id, club_team_id),
      club_team_name  = COALESCE(NULLIF(btrim(p_club_team_name), ''), club_team_name),
      opponent_name   = COALESCE(NULLIF(btrim(p_opponent_name), ''), opponent_name),
      is_home         = COALESCE(p_is_home, is_home),
      scheduled_date  = COALESCE(p_scheduled_date, scheduled_date),
      kickoff_time    = COALESCE(p_kickoff_time, kickoff_time),
      playing_area_id = COALESCE(p_playing_area_id, playing_area_id),
      official_id     = COALESCE(p_official_id, official_id),
      ref_name        = COALESCE(NULLIF(btrim(p_ref_name), ''), ref_name),
      home_score      = COALESCE(p_home_score, home_score),
      away_score      = COALESCE(p_away_score, away_score),
      status          = COALESCE(p_status, status),
      notes           = COALESCE(NULLIF(btrim(p_notes), ''), notes),
      updated_at      = now()
    WHERE id = p_fixture_id;

    INSERT INTO public.audit_events
      (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
            'club_fixture_updated', 'club_fixture', p_fixture_id::text,
            jsonb_build_object('status', p_status));
    RETURN jsonb_build_object('ok', true, 'fixture_id', p_fixture_id, 'share_code', v_league.share_code, 'created', false);
  END IF;
END;
$function$;


-- ============================================================================
-- 4. venue_delete_club_fixture — club_id from the fixture/league row.
--    Live body only does an EXISTS check (no club_id var); guard resolves
--    club_id via scalar subquery (fixture JOIN league), after fixture_not_found,
--    before DELETE.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.venue_delete_club_fixture(p_venue_token text, p_fixture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_fixtures f
    JOIN public.club_leagues cl ON cl.id = f.league_id
    WHERE f.id = p_fixture_id AND cl.venue_id = v_venue) THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(
       (SELECT cl.club_id FROM public.club_fixtures f
          JOIN public.club_leagues cl ON cl.id = f.league_id
         WHERE f.id = p_fixture_id AND cl.venue_id = v_venue),
       'competition') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.club_fixtures WHERE id = p_fixture_id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_fixture_deleted', 'club_fixture', p_fixture_id::text, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$function$;


-- ============================================================================
-- 5. venue_set_matchday_info — venue-level only, no league/club in scope.
--    Use the UNION helper on v_venue, after cap check, before UPDATE.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.venue_set_matchday_info(p_venue_token text, p_info jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._venue_club_feature_enabled(v_venue, 'competition') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venues
     SET matchday_info = COALESCE(p_info, '{}'::jsonb)
   WHERE id = v_venue;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_matchday_info_set', 'venue', v_venue, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ─── tournaments ───────────────────────────────────────────────────────────────────
-- 399_guards_tournaments.sql
--
-- DRAFT — feature-flag guards for the TOURNAMENTS (Event OS) write RPCs.
--
-- 'tournaments' is a CLUB-owned feature. Each guarded function resolves the
-- owning club_id (direct param, via slug, via tournament_event, or for the
-- ref_* RPCs via fixture → competition → tournament_event) and gates on:
--     public._club_feature_enabled(<club_id>, 'tournaments')
-- raising 'feature_disabled' (P0001) before any mutating write.
--
-- Every body below is BYTE-IDENTICAL to the live function EXCEPT the single
-- guard block (and, for the ref_* RPCs only, one added `v_club_id text;`
-- declaration plus a read-only SELECT to reach club_id — no other change).
-- Signature / RETURNS / volatility / SECURITY DEFINER / SET search_path /
-- LANGUAGE / $function$ tags are all preserved verbatim. GRANTs untouched.
--
-- Helpers (verified present):
--   public._club_feature_enabled(p_club_id text, p_feature text)
--   public._venue_club_feature_enabled(p_venue_id text, p_feature text)  -- unused; club_id reachable everywhere

-- ============================================================================
-- 1. club_admin_create_tournament — club_id direct (p_club_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_create_tournament(p_club_id text, p_venue_id text, p_name text, p_slug text, p_event_date date, p_event_end_date date DEFAULT NULL::date, p_entry_fee_pence integer DEFAULT 0, p_entry_fee_payer text DEFAULT 'per_team'::text, p_registration_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_tournament_id uuid;
  v_name          text := NULLIF(btrim(p_name), '');
  v_slug          text := NULLIF(btrim(lower(p_slug)), '');
BEGIN
  -- Auth
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = p_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(p_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  -- Validate club exists
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = p_club_id) THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Validate venue is associated with this club
  IF NOT EXISTS (SELECT 1 FROM club_venues WHERE club_id = p_club_id AND venue_id = p_venue_id) THEN
    RAISE EXCEPTION 'venue_not_associated' USING ERRCODE = 'P0001';
  END IF;

  -- Validate inputs
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_slug !~ '^[a-z0-9][a-z0-9\-]{1,79}$' THEN
    RAISE EXCEPTION 'slug_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_date IS NULL THEN
    RAISE EXCEPTION 'event_date_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_end_date IS NOT NULL AND p_event_end_date < p_event_date THEN
    RAISE EXCEPTION 'end_date_before_start' USING ERRCODE = 'P0001';
  END IF;
  IF p_entry_fee_payer NOT IN ('per_team', 'per_athlete') THEN
    RAISE EXCEPTION 'invalid_entry_fee_payer' USING ERRCODE = 'P0001';
  END IF;

  -- Slug uniqueness enforced by DB UNIQUE constraint — let it surface naturally
  INSERT INTO tournament_events (
    venue_id, club_id, name, slug, event_date, event_end_date,
    entry_fee_pence, entry_fee_payer, registration_deadline
  ) VALUES (
    p_venue_id, p_club_id, v_name, v_slug, p_event_date, p_event_end_date,
    COALESCE(p_entry_fee_pence, 0), COALESCE(p_entry_fee_payer, 'per_team'), p_registration_deadline
  ) RETURNING id INTO v_tournament_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    p_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_created', 'tournament_event', v_tournament_id::text,
    jsonb_build_object('club_id', p_club_id, 'venue_id', p_venue_id, 'name', v_name, 'slug', v_slug, 'event_date', p_event_date)
  );

  RETURN jsonb_build_object('ok', true, 'tournament_id', v_tournament_id, 'slug', v_slug);
END;
$function$;

-- ============================================================================
-- 2. club_admin_update_tournament_status — club_id via slug→tournament_events
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_update_tournament_status(p_slug text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_tournament_id uuid;
  v_club_id       text;
  v_old_status    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Validate status value against the DB CHECK constraint enum
  IF p_status NOT IN ('draft', 'open', 'closed', 'live', 'completed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, club_id, status
    INTO v_tournament_id, v_club_id, v_old_status
    FROM tournament_events
   WHERE slug = p_slug
   LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Verify caller is an active manager of this tournament's club
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET status = p_status
   WHERE id = v_tournament_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_status_changed', 'tournament_event', v_tournament_id::text,
    jsonb_build_object('slug', p_slug, 'old_status', v_old_status, 'new_status', p_status)
  );

  RETURN jsonb_build_object('ok', true, 'slug', p_slug, 'status', p_status);
END;
$function$;

-- ============================================================================
-- 3. club_admin_add_competition — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_add_competition(p_tournament_event_id uuid, p_name text, p_type text, p_format text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid            uuid := auth.uid();
  v_profile_id     uuid;
  v_club_id        text;
  v_competition_id uuid;
  v_name           text := NULLIF(btrim(p_name), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competitions (season_id, tournament_event_id, name, type, format, status)
  VALUES (NULL, p_tournament_event_id, v_name, p_type, p_format, 'setup')
  RETURNING id INTO v_competition_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_competition_added', 'competition', v_competition_id::text,
    jsonb_build_object('tournament_event_id', p_tournament_event_id, 'name', v_name, 'type', p_type)
  );

  RETURN jsonb_build_object('ok', true, 'competition_id', v_competition_id);
END;
$function$;

-- ============================================================================
-- 4. club_admin_generate_schedule — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_generate_schedule(p_tournament_event_id uuid, p_competition_id uuid, p_slot_minutes integer, p_start_time time without time zone, p_start_date date, p_playing_area_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_club_id     text;
  v_venue_id    text;
  v_teams       uuid[];
  v_n           int;
  v_m           int;
  v_pitch_n     int;
  v_round       int;
  v_slot        int;
  v_home        uuid;
  v_away        uuid;
  v_match_count int := 0;
  v_kickoff     time;
  v_pitch       uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id, te.venue_id
    INTO v_club_id, v_venue_id
    FROM tournament_events te
   WHERE te.id = p_tournament_event_id
   LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM fixtures WHERE competition_id = p_competition_id LIMIT 1) THEN
    RAISE EXCEPTION 'fixtures_already_exist' USING ERRCODE = 'P0001';
  END IF;

  -- Validate all pitches belong to the tournament's venue
  v_pitch_n := COALESCE(array_length(p_playing_area_ids, 1), 0);
  IF v_pitch_n > 0 AND EXISTS (
    SELECT 1 FROM unnest(p_playing_area_ids) AS t(pa_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM playing_areas pa
      WHERE pa.id = t.pa_id AND pa.venue_id = v_venue_id AND pa.active = true
    )
  ) THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  -- Load active teams ordered by registration time for determinism
  SELECT ARRAY(
    SELECT id FROM competition_teams
    WHERE competition_id = p_competition_id AND status = 'active'
    ORDER BY registered_at, id
  ) INTO v_teams;

  v_n := COALESCE(array_length(v_teams, 1), 0);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'not_enough_teams' USING ERRCODE = 'P0001';
  END IF;

  -- Odd N: append NULL as bye to make count even
  IF v_n % 2 = 1 THEN
    v_teams := v_teams || ARRAY[NULL::uuid];
    v_n     := v_n + 1;
  END IF;

  v_m := v_n - 1; -- number of rounds

  -- Circle method: v_teams[v_n] is fixed; v_teams[1..v_n-1] rotate each round.
  -- Each round: pair slot k → home=v_teams[k], away=v_teams[v_n-k+1] for k=1..v_n/2.
  -- After each round rotate: new = [v_teams[1], v_teams[v_n], v_teams[2..v_n-1]].
  FOR v_round IN 1..v_m LOOP
    FOR v_slot IN 1..(v_n / 2) LOOP
      v_home := v_teams[v_slot];
      v_away := v_teams[v_n - v_slot + 1];

      -- Skip bye (NULL team)
      IF v_home IS NULL OR v_away IS NULL THEN
        CONTINUE;
      END IF;

      -- Time: concurrent batches of pitch_count matches share the same slot
      v_kickoff := p_start_time
                 + ((v_match_count / GREATEST(v_pitch_n, 1)) * p_slot_minutes
                    * INTERVAL '1 minute');

      -- Pitch: cycle through available pitches
      v_pitch := CASE WHEN v_pitch_n > 0
                      THEN p_playing_area_ids[(v_match_count % v_pitch_n) + 1]
                      ELSE NULL END;

      INSERT INTO fixtures (
        competition_id,
        home_competition_team_id, away_competition_team_id,
        week_number, round_name,
        scheduled_date, kickoff_time,
        playing_area_id, slot_minutes,
        status
      ) VALUES (
        p_competition_id,
        v_home, v_away,
        v_round, 'Round ' || v_round,
        p_start_date, v_kickoff,
        v_pitch, p_slot_minutes,
        'scheduled'
      );

      v_match_count := v_match_count + 1;
    END LOOP;

    -- Rotate: keep v_teams[1] fixed, move v_teams[v_n] to position 2,
    -- shift v_teams[2..v_n-1] one step right.
    v_teams := ARRAY[v_teams[1]] || ARRAY[v_teams[v_n]] || v_teams[2:v_n - 1];
  END LOOP;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier,
     action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_schedule_generated', 'competition', p_competition_id::text,
    jsonb_build_object(
      'tournament_event_id', p_tournament_event_id,
      'fixtures_created',    v_match_count,
      'rounds',              v_m,
      'slot_minutes',        p_slot_minutes
    )
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'fixtures_created', v_match_count,
    'rounds',           v_m
  );
END;
$function$;

-- ============================================================================
-- 5. club_admin_assign_fixture_slot — club_id via fixture→competition→tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_assign_fixture_slot(p_fixture_id uuid, p_scheduled_date date DEFAULT NULL::date, p_kickoff_time time without time zone DEFAULT NULL::time without time zone, p_playing_area_id uuid DEFAULT NULL::uuid, p_slot_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve owning club via fixture → competition → tournament_event
  SELECT te.club_id INTO v_club_id
    FROM fixtures fx
    JOIN competitions c ON c.id = fx.competition_id
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE fx.id = p_fixture_id
   LIMIT 1;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'fixture_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE fixtures
     SET scheduled_date  = COALESCE(p_scheduled_date,  scheduled_date),
         kickoff_time    = COALESCE(p_kickoff_time,    kickoff_time),
         playing_area_id = COALESCE(p_playing_area_id, playing_area_id),
         slot_minutes    = COALESCE(p_slot_minutes,    slot_minutes)
   WHERE id = p_fixture_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier,
     action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_fixture_slot_updated', 'fixture', p_fixture_id::text,
    jsonb_build_object(
      'scheduled_date',  p_scheduled_date,
      'kickoff_time',    p_kickoff_time,
      'playing_area_id', p_playing_area_id,
      'slot_minutes',    p_slot_minutes
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ============================================================================
-- 6. club_admin_set_performance_config — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_set_performance_config(p_tournament_event_id uuid, p_points_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_club_id     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM performance_results pr
    JOIN performance_events pe ON pe.id = pr.performance_event_id
    WHERE pe.tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'results_already_recorded' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_points_config) <> 'object' THEN
    RAISE EXCEPTION 'invalid_points_config' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET points_config = p_points_config
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin',
          'tournament_performance_config_updated',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id, 'points_config', p_points_config));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ============================================================================
-- 7. club_admin_add_performance_event — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_add_performance_event(p_tournament_event_id uuid, p_name text, p_measurement_type text, p_unit text, p_attempts_per_athlete integer DEFAULT 1, p_category text DEFAULT NULL::text, p_scheduled_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_display_order integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_profile_id  uuid;
  v_club_id     text;
  v_event_id    uuid;
  v_name        text := NULLIF(btrim(p_name), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_measurement_type NOT IN ('time_asc','time_desc','distance','height','weight') THEN
    RAISE EXCEPTION 'invalid_measurement_type' USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(btrim(p_unit), '') IS NULL THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO performance_events (
    tournament_event_id, name, sport, measurement_type, unit,
    attempts_per_athlete, category, scheduled_time, display_order
  )
  VALUES (
    p_tournament_event_id, v_name, 'athletics', p_measurement_type, btrim(p_unit),
    COALESCE(p_attempts_per_athlete, 1), p_category, p_scheduled_time, p_display_order
  )
  RETURNING id INTO v_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin',
          'tournament_performance_event_added',
          'performance_event', v_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id,
                             'performance_event_id', v_event_id,
                             'name', v_name));

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id);
END;
$function$;

-- ============================================================================
-- 8. club_admin_record_result — club_id via performance_event→tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_record_result(p_performance_event_id uuid, p_athlete_name text, p_competition_team_id uuid, p_value numeric, p_attempt_number integer DEFAULT 1, p_status text DEFAULT 'recorded'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_profile_id    uuid;
  v_club_id       text;
  v_tournament_id uuid;
  v_result_id     uuid;
  v_name          text := NULLIF(btrim(p_athlete_name), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT pe.tournament_event_id, te.club_id
    INTO v_tournament_id, v_club_id
    FROM performance_events pe
    JOIN tournament_events te ON te.id = pe.tournament_event_id
   WHERE pe.id = p_performance_event_id
   LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'athlete_name_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'competition_team_required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competition_teams ct
    JOIN competitions c ON c.id = ct.competition_id
    WHERE ct.id = p_competition_team_id
      AND c.tournament_event_id = v_tournament_id
  ) THEN
    RAISE EXCEPTION 'team_not_in_tournament' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('recorded','dns','dnf','disqualified') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO performance_results (
    performance_event_id, athlete_name, competition_team_id,
    value, attempt_number, status, recorded_by
  )
  VALUES (
    p_performance_event_id, v_name, p_competition_team_id,
    p_value, COALESCE(p_attempt_number, 1), p_status, v_uid
  )
  ON CONFLICT (performance_event_id, competition_team_id, athlete_name, attempt_number)
  DO UPDATE SET
    value       = EXCLUDED.value,
    status      = EXCLUDED.status,
    recorded_at = now(),
    recorded_by = EXCLUDED.recorded_by
  RETURNING id INTO v_result_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin',
          'tournament_result_recorded',
          'performance_result', v_result_id::text,
          jsonb_build_object('performance_event_id', p_performance_event_id,
                             'result_id', v_result_id,
                             'athlete_name', v_name,
                             'value', p_value,
                             'status', p_status));

  RETURN jsonb_build_object('ok', true, 'result_id', v_result_id);
END;
$function$;

-- ============================================================================
-- 9. club_admin_add_sponsor — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_add_sponsor(p_tournament_event_id uuid, p_name text, p_logo_url text DEFAULT NULL::text, p_website_url text DEFAULT NULL::text, p_display_order integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_name       text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_sponsor_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO tournament_sponsors (
    tournament_event_id, name, logo_url, website_url, display_order
  )
  VALUES (
    p_tournament_event_id,
    v_name,
    NULLIF(btrim(COALESCE(p_logo_url, '')), ''),
    NULLIF(btrim(COALESCE(p_website_url, '')), ''),
    COALESCE(p_display_order, 0)
  )
  RETURNING id INTO v_sponsor_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_sponsor_added',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object(
            'tournament_event_id', p_tournament_event_id,
            'sponsor_id',          v_sponsor_id,
            'name',                v_name
          ));

  RETURN jsonb_build_object('ok', true, 'sponsor_id', v_sponsor_id);
END;
$function$;

-- ============================================================================
-- 10. club_admin_set_branding — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_set_branding(p_tournament_event_id uuid, p_primary_colour text DEFAULT NULL::text, p_secondary_colour text DEFAULT NULL::text, p_custom_logo_url text DEFAULT NULL::text, p_tagline text DEFAULT NULL::text, p_hero_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET branding = jsonb_strip_nulls(jsonb_build_object(
           'primary_colour',   NULLIF(btrim(COALESCE(p_primary_colour, '')), ''),
           'secondary_colour', NULLIF(btrim(COALESCE(p_secondary_colour, '')), ''),
           'custom_logo_url',  NULLIF(btrim(COALESCE(p_custom_logo_url, '')), ''),
           'tagline',          NULLIF(btrim(COALESCE(p_tagline, '')), ''),
           'hero_url',         NULLIF(btrim(COALESCE(p_hero_url, '')), '')
         ))
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_branding_updated',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ============================================================================
-- 11. club_admin_set_player_of_tournament — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_set_player_of_tournament(p_tournament_event_id uuid, p_name text, p_team_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_name       text := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET player_of_tournament_name = v_name,
         player_of_tournament_team = NULLIF(btrim(COALESCE(p_team_name, '')), '')
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_pot_set',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object(
            'tournament_event_id', p_tournament_event_id,
            'name',                v_name,
            'team_name',           p_team_name
          ));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ============================================================================
-- 12. club_admin_register_team — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_register_team(p_tournament_event_id uuid, p_competition_id uuid, p_team_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid                 uuid := auth.uid();
  v_profile_id          uuid;
  v_club_id             text;
  v_team_name           text := NULLIF(btrim(p_team_name), '');
  v_competition_team_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF v_team_name IS NULL THEN
    RAISE EXCEPTION 'team_name_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competitions
    WHERE id = p_competition_id AND tournament_event_id = p_tournament_event_id
  ) THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competition_teams (competition_id, team_name, status)
  VALUES (p_competition_id, v_team_name, 'active')
  RETURNING id INTO v_competition_team_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_club_id, v_uid, 'club_admin', v_uid::text,
    'tournament_team_registered', 'competition_team', v_competition_team_id::text,
    jsonb_build_object('tournament_event_id', p_tournament_event_id, 'competition_id', p_competition_id, 'team_name', v_team_name)
  );

  RETURN jsonb_build_object('ok', true, 'competition_team_id', v_competition_team_id);
END;
$function$;

-- ============================================================================
-- 13. club_admin_book_equipment_for_tournament — club_id via tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_admin_book_equipment_for_tournament(p_tournament_event_id uuid, p_equipment_id uuid, p_qty integer, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_due_back_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
  v_venue_id   text;
  v_te_name    text;
  v_eq         record;
  v_peak       int;
  v_free       int;
  v_booking_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id, venue_id, name INTO v_club_id, v_venue_id, v_te_name
    FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_eq FROM equipment WHERE id = p_equipment_id FOR UPDATE;
  IF v_eq.id IS NULL THEN
    RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_eq.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'equipment_not_at_venue' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_eq.active THEN
    RAISE EXCEPTION 'equipment_inactive' USING ERRCODE = 'P0001';
  END IF;

  v_peak := public._equipment_peak_committed(p_equipment_id, p_start_at, p_end_at);
  v_free  := v_eq.quantity - v_peak;
  IF p_qty > v_free THEN
    RAISE EXCEPTION 'insufficient_availability' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO equipment_bookings (
    equipment_id, venue_id, booked_by_name,
    qty, start_at, end_at, due_back_at,
    tournament_event_id, status
  )
  VALUES (
    p_equipment_id, v_venue_id, 'Tournament: ' || v_te_name,
    p_qty, p_start_at, p_end_at, p_due_back_at,
    p_tournament_event_id, 'confirmed'
  )
  RETURNING id INTO v_booking_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_equipment_booked',
          'equipment_booking', v_booking_id::text,
          jsonb_build_object(
            'tournament_event_id', p_tournament_event_id,
            'booking_id',          v_booking_id,
            'equipment_id',        p_equipment_id,
            'qty',                 p_qty
          ));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id);
END;
$function$;

-- ============================================================================
-- 14. tournament_register_team (public) — club_id via slug→tournament_events (v_te.club_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_register_team(p_slug text, p_competition_id uuid, p_team_name text, p_contact_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_te        record;
  v_comp      record;
  v_team_name text := NULLIF(btrim(p_team_name), '');
  v_email     text := NULLIF(btrim(p_contact_email), '');
  v_ct_id     uuid;
BEGIN
  IF v_team_name IS NULL THEN
    RAISE EXCEPTION 'team_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_team_name) > 60 THEN
    RAISE EXCEPTION 'team_name_too_long' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.id, te.club_id, te.name, te.status, te.registration_deadline
    INTO v_te
    FROM tournament_events te
   WHERE te.slug = p_slug
   LIMIT 1;
  IF v_te IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._club_feature_enabled(v_te.club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_te.status <> 'open'
     OR (v_te.registration_deadline IS NOT NULL AND now() >= v_te.registration_deadline) THEN
    RAISE EXCEPTION 'registration_closed' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.id, c.name
    INTO v_comp
    FROM competitions c
   WHERE c.id = p_competition_id AND c.tournament_event_id = v_te.id
   LIMIT 1;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'competition_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM competition_teams ct
     WHERE ct.competition_id = p_competition_id
       AND lower(btrim(ct.team_name)) = lower(v_team_name)
       AND ct.status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'team_name_taken' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competition_teams (competition_id, team_name, status)
  VALUES (p_competition_id, v_team_name, 'pending')
  RETURNING id INTO v_ct_id;

  INSERT INTO audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (
    v_te.club_id, auth.uid(), 'system', COALESCE(v_email, 'public'),
    'tournament_team_registered', 'competition_team', v_ct_id::text,
    jsonb_build_object('slug', p_slug, 'team_name', v_team_name,
      'competition_id', p_competition_id, 'contact_email', v_email)
  );

  RETURN jsonb_build_object(
    'ok',                  true,
    'competition_team_id', v_ct_id,
    'status',              'pending',
    'tournament_name',     v_te.name,
    'competition_name',    v_comp.name
  );
END;
$function$;

-- ============================================================================
-- 15. ref_start_tournament_match — club_id via fixture.competition_id→competitions→tournament_events
--     (added `v_club_id text;` + a read-only SELECT; guard before the UPDATE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ref_start_tournament_match(p_ref_token text, p_client_event_id uuid, p_local_timestamp timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture     public.fixtures;
  v_suspensions jsonb;
  v_club_id     text;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id INTO v_club_id
    FROM competitions c
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE c.id = v_fixture.competition_id
   LIMIT 1;
  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status NOT IN ('scheduled', 'allocated') THEN
    RAISE EXCEPTION 'fixture_status_locks_start' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  UPDATE public.fixtures
     SET status            = 'in_progress',
         actual_kickoff_at = p_local_timestamp,
         current_period    = '1H'
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_start_tournament_match',
    'fixture', v_fixture.id::text,
    jsonb_build_object(
      'competition_id',    v_fixture.competition_id,
      'actual_kickoff_at', p_local_timestamp,
      'client_event_id',   p_client_event_id
    )
  );

  -- Return known suspensions so PreMatch can show a pre-start warning.
  -- Uses DISTINCT to avoid duplicates when a player has multiple suspended cards.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'competition_team_id', sub.competition_team_id::text,
        'team_name',           sub.team_name,
        'player_name',         sub.player_name
      ) ORDER BY sub.team_name, sub.player_name
    ),
    '[]'::jsonb
  )
  INTO v_suspensions
  FROM (
    SELECT DISTINCT tc.competition_team_id, ct.team_name, tc.player_name
    FROM public.tournament_cards tc
    JOIN public.competition_teams ct ON ct.id = tc.competition_team_id
    WHERE tc.competition_id = v_fixture.competition_id
      AND tc.auto_suspended = true
      AND tc.competition_team_id IN (
        v_fixture.home_competition_team_id,
        v_fixture.away_competition_team_id
      )
  ) sub;

  RETURN jsonb_build_object(
    'ok',          true,
    'fixture_id',  v_fixture.id,
    'status',      'in_progress',
    'suspensions', v_suspensions
  );
END;
$function$;

-- ============================================================================
-- 16. ref_set_tournament_period — club_id via fixture→competition→tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ref_set_tournament_period(p_ref_token text, p_period text, p_client_event_id uuid, p_local_timestamp timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_club_id text;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;

  IF p_period NOT IN ('HT', '2H', 'ET1', 'ET2', 'FT') THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = 'P0001', DETAIL = p_period;
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id INTO v_club_id
    FROM competitions c
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE c.id = v_fixture.competition_id
   LIMIT 1;
  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  UPDATE public.fixtures SET current_period = p_period WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_set_tournament_period',
    'fixture', v_fixture.id::text,
    jsonb_build_object('period', p_period, 'client_event_id', p_client_event_id)
  );

  RETURN jsonb_build_object('ok', true, 'period', p_period);
END;
$function$;

-- ============================================================================
-- 17. ref_record_tournament_goal — club_id via fixture→competition→tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ref_record_tournament_goal(p_ref_token text, p_side text, p_minute integer, p_period text, p_client_event_id uuid, p_player_id text DEFAULT NULL::text, p_player_name_override text DEFAULT NULL::text, p_own_goal boolean DEFAULT false, p_local_timestamp timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture      public.fixtures;
  v_scoring_side text;
  v_home         integer;
  v_away         integer;
  v_club_id      text;
BEGIN
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE = 'P0001';
  END IF;

  IF p_side NOT IN ('home', 'away') THEN
    RAISE EXCEPTION 'invalid_side' USING ERRCODE = 'P0001', DETAIL = p_side;
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id INTO v_club_id
    FROM competitions c
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE c.id = v_fixture.competition_id
   LIMIT 1;
  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  v_scoring_side := CASE
    WHEN p_own_goal THEN (CASE WHEN p_side = 'home' THEN 'away' ELSE 'home' END)
    ELSE p_side
  END;

  IF v_scoring_side = 'home' THEN
    UPDATE public.fixtures
       SET home_score = COALESCE(home_score, 0) + 1
     WHERE id = v_fixture.id
    RETURNING home_score, away_score INTO v_home, v_away;
  ELSE
    UPDATE public.fixtures
       SET away_score = COALESCE(away_score, 0) + 1
     WHERE id = v_fixture.id
    RETURNING home_score, away_score INTO v_home, v_away;
  END IF;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token,
    CASE WHEN p_own_goal THEN 'ref_record_tournament_own_goal' ELSE 'ref_record_tournament_goal' END,
    'fixture', v_fixture.id::text,
    jsonb_build_object(
      'side',            p_side,
      'scoring_side',    v_scoring_side,
      'minute',          p_minute,
      'period',          p_period,
      'player_id',       p_player_id,
      'player_name',     p_player_name_override,
      'home_score',      v_home,
      'away_score',      v_away,
      'client_event_id', p_client_event_id,
      'own_goal',        p_own_goal
    )
  );

  RETURN jsonb_build_object('ok', true, 'home_score', v_home, 'away_score', v_away);
END;
$function$;

-- ============================================================================
-- 18. ref_undo_tournament_goal — club_id via fixture→competition→tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ref_undo_tournament_goal(p_ref_token text, p_side text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_home    integer;
  v_away    integer;
  v_club_id text;
BEGIN
  IF p_side NOT IN ('home', 'away') THEN
    RAISE EXCEPTION 'invalid_side' USING ERRCODE = 'P0001', DETAIL = p_side;
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id INTO v_club_id
    FROM competitions c
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE c.id = v_fixture.competition_id
   LIMIT 1;
  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  IF p_side = 'home' THEN
    UPDATE public.fixtures
       SET home_score = GREATEST(0, COALESCE(home_score, 0) - 1)
     WHERE id = v_fixture.id
    RETURNING home_score, away_score INTO v_home, v_away;
  ELSE
    UPDATE public.fixtures
       SET away_score = GREATEST(0, COALESCE(away_score, 0) - 1)
     WHERE id = v_fixture.id
    RETURNING home_score, away_score INTO v_home, v_away;
  END IF;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_undo_tournament_goal',
    'fixture', v_fixture.id::text,
    jsonb_build_object('side', p_side, 'home_score', v_home, 'away_score', v_away)
  );

  RETURN jsonb_build_object('ok', true, 'home_score', v_home, 'away_score', v_away);
END;
$function$;

-- ============================================================================
-- 19. ref_confirm_tournament_match — club_id via fixture→competition→tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ref_confirm_tournament_match(p_ref_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture public.fixtures;
  v_home    integer;
  v_away    integer;
  v_club_id text;
BEGIN
  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id INTO v_club_id
    FROM competitions c
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE c.id = v_fixture.competition_id
   LIMIT 1;
  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  v_home := COALESCE(v_fixture.home_score, 0);
  v_away := COALESCE(v_fixture.away_score, 0);

  UPDATE public.fixtures
     SET status         = 'completed',
         current_period = 'FT'
   WHERE id = v_fixture.id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_confirm_tournament_match',
    'fixture', v_fixture.id::text,
    jsonb_build_object('home_score', v_home, 'away_score', v_away)
  );

  IF v_fixture.group_label IS NULL THEN
    IF v_fixture.de_bracket IS NOT NULL THEN
      PERFORM public._advance_tournament_double_elim(v_fixture.id);
    ELSE
      PERFORM public._advance_tournament_winner(v_fixture.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'home_score', v_home, 'away_score', v_away, 'status', 'completed'
  );
END;
$function$;

-- ============================================================================
-- 20. ref_record_tournament_card — club_id via fixture→competition→tournament_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ref_record_tournament_card(p_ref_token text, p_competition_team_id uuid, p_player_name text, p_card_type text, p_minute integer, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fixture        public.fixtures;
  v_player_name    text    := NULLIF(btrim(p_player_name), '');
  v_yellow_count   integer;
  v_auto_suspended boolean;
  v_card_id        uuid;
  v_club_id        text;
BEGIN
  IF v_player_name IS NULL THEN
    RAISE EXCEPTION 'player_name_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_card_type NOT IN ('yellow', 'red') THEN
    RAISE EXCEPTION 'invalid_card_type' USING ERRCODE = 'P0001', DETAIL = p_card_type;
  END IF;

  v_fixture := public._ref_resolve_fixture(p_ref_token);

  IF v_fixture.home_competition_team_id IS NULL THEN
    RAISE EXCEPTION 'not_a_tournament_fixture' USING ERRCODE = 'P0001';
  END IF;

  SELECT te.club_id INTO v_club_id
    FROM competitions c
    JOIN tournament_events te ON te.id = c.tournament_event_id
   WHERE c.id = v_fixture.competition_id
   LIMIT 1;
  IF NOT public._club_feature_enabled(v_club_id, 'tournaments') THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF v_fixture.status <> 'in_progress' THEN
    RAISE EXCEPTION 'fixture_not_in_progress' USING ERRCODE = 'P0001',
      DETAIL = v_fixture.status;
  END IF;

  IF p_competition_team_id NOT IN (
    v_fixture.home_competition_team_id,
    v_fixture.away_competition_team_id
  ) THEN
    RAISE EXCEPTION 'team_not_in_fixture' USING ERRCODE = 'P0001';
  END IF;

  -- Auto-suspension: red = always; yellow = suspended if already has one yellow this competition
  IF p_card_type = 'red' THEN
    v_auto_suspended := true;
  ELSE
    SELECT COUNT(*)::integer INTO v_yellow_count
    FROM public.tournament_cards
    WHERE competition_id      = v_fixture.competition_id
      AND competition_team_id = p_competition_team_id
      AND player_name         = v_player_name
      AND card_type           = 'yellow';

    v_auto_suspended := (v_yellow_count >= 1);
  END IF;

  INSERT INTO public.tournament_cards (
    fixture_id, competition_id, competition_team_id,
    player_name, card_type, minute, period,
    auto_suspended, recorded_by_ref_token
  ) VALUES (
    v_fixture.id, v_fixture.competition_id, p_competition_team_id,
    v_player_name, p_card_type, p_minute, p_period,
    v_auto_suspended, p_ref_token
  ) RETURNING id INTO v_card_id;

  INSERT INTO public.audit_events (
    team_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata
  ) VALUES (
    '_system', 'referee', p_ref_token, 'ref_record_tournament_card',
    'tournament_card', v_card_id::text,
    jsonb_build_object(
      'competition_id',      v_fixture.competition_id,
      'competition_team_id', p_competition_team_id,
      'player_name',         v_player_name,
      'card_type',           p_card_type,
      'minute',              p_minute,
      'period',              p_period,
      'auto_suspended',      v_auto_suspended
    )
  );

  RETURN jsonb_build_object(
    'ok',           true,
    'card_id',      v_card_id,
    'is_suspended', v_auto_suspended,
    'player_name',  v_player_name,
    'card_type',    p_card_type
  );
END;
$function$;
