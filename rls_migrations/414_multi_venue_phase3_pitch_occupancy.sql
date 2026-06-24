-- Migration 414 — Multi-venue (pilot #7) Phase 3: pitch occupancy / clash protection.
--
-- Phases 1 (mig 412, sessions) + 2 (mig 413, fixtures) anchored every club activity to
-- the right venue + pitch. This projects club SESSIONS and club FIXTURES into the shared
-- pitch_occupancy ledger so they (a) show busy on the venue calendar and (b) are blocked
-- from double-booking by the existing EXCLUDE constraint (pitch_occupancy_no_overlap),
-- surfaced as a friendly 'slot_unavailable'. Cross-site: a new operator-wide reader feeds
-- a unified calendar across all the operator's same-company venues.
--
-- Mechanism mirrors the live league-fixture pattern (tg_sync_fixture_occupancy, mig 379):
-- a TRIGGER per table covers EVERY create/update/cancel/void/delete path in one place, so
-- no release path can be missed. Default slot length 60 min (neither table has a duration
-- column). Venue resolved from the pitch (playing_areas.venue_id) — authoritative.
--
-- Gates passed: rpc-security (SECDEF/search_path/single-overload on both readers; helpers
-- locked to definer-only); ephemeral-verify (own _e2e_ 2-venue same-company club + 1 foreign
-- venue: session reserves → 2nd activity same pitch+time rejected slot_unavailable →
-- cancel/void/delete release → cross-site reader scopes to operator and excludes the foreign
-- venue; 8/8 assert groups, leak 0).

-- ─── 1. Allow the two new occupancy sources ──────────────────────────────────
ALTER TABLE public.pitch_occupancy DROP CONSTRAINT IF EXISTS pitch_occupancy_source_kind_check;
ALTER TABLE public.pitch_occupancy ADD CONSTRAINT pitch_occupancy_source_kind_check
  CHECK (source_kind = ANY (ARRAY['fixture','booking','maintenance','club_session','club_fixture']));

-- ─── 2. club_sessions → occupancy (training reserves its pitch) ──────────────
CREATE OR REPLACE FUNCTION public.tg_sync_club_session_occupancy()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_venue_id text;
  v_start    timestamptz;
  v_range    tstzrange;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_session' AND source_id = OLD.id::text;
    RETURN OLD;
  END IF;

  IF NEW.status = 'scheduled'
     AND NEW.playing_area_id IS NOT NULL
     AND NEW.scheduled_at IS NOT NULL THEN
    SELECT pa.venue_id INTO v_venue_id FROM public.playing_areas pa WHERE pa.id = NEW.playing_area_id;
    IF v_venue_id IS NULL THEN
      UPDATE public.pitch_occupancy SET active = false
        WHERE source_kind = 'club_session' AND source_id = NEW.id::text;
      RETURN NEW;
    END IF;
    v_start := NEW.scheduled_at;
    v_range := tstzrange(v_start, v_start + make_interval(mins => 60), '[)');
    BEGIN
      INSERT INTO public.pitch_occupancy
        (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
      VALUES (NEW.playing_area_id, v_venue_id, v_range, 'club_session', NEW.id::text, 1, true)
      ON CONFLICT (source_kind, source_id) DO UPDATE
        SET playing_area_id = EXCLUDED.playing_area_id,
            venue_id        = EXCLUDED.venue_id,
            time_range      = EXCLUDED.time_range,
            priority        = 1,
            active          = true;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
    END;
  ELSE
    -- cancelled / pitch cleared / venue cleared → release the slot
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_session' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_club_session_occupancy ON public.club_sessions;
CREATE TRIGGER sync_club_session_occupancy
  AFTER INSERT OR DELETE OR UPDATE OF status, venue_id, playing_area_id, scheduled_at
  ON public.club_sessions FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_club_session_occupancy();

-- ─── 3. club_fixtures → occupancy (matches reserve their pitch) ──────────────
CREATE OR REPLACE FUNCTION public.tg_sync_club_fixture_occupancy()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_venue_id text;
  v_start    timestamptz;
  v_range    tstzrange;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_fixture' AND source_id = OLD.id::text;
    RETURN OLD;
  END IF;

  IF NEW.status IN ('scheduled','completed')
     AND NEW.playing_area_id IS NOT NULL
     AND NEW.scheduled_date IS NOT NULL
     AND NEW.kickoff_time IS NOT NULL THEN
    SELECT pa.venue_id INTO v_venue_id FROM public.playing_areas pa WHERE pa.id = NEW.playing_area_id;
    IF v_venue_id IS NULL THEN
      UPDATE public.pitch_occupancy SET active = false
        WHERE source_kind = 'club_fixture' AND source_id = NEW.id::text;
      RETURN NEW;
    END IF;
    v_start := (NEW.scheduled_date + NEW.kickoff_time) AT TIME ZONE 'Europe/London';
    v_range := tstzrange(v_start, v_start + make_interval(mins => 60), '[)');
    BEGIN
      INSERT INTO public.pitch_occupancy
        (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
      VALUES (NEW.playing_area_id, v_venue_id, v_range, 'club_fixture', NEW.id::text, 1, true)
      ON CONFLICT (source_kind, source_id) DO UPDATE
        SET playing_area_id = EXCLUDED.playing_area_id,
            venue_id        = EXCLUDED.venue_id,
            time_range      = EXCLUDED.time_range,
            priority        = 1,
            active          = true;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
    END;
  ELSE
    -- postponed / void / pitch cleared → release the slot
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_fixture' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_club_fixture_occupancy ON public.club_fixtures;
CREATE TRIGGER sync_club_fixture_occupancy
  AFTER INSERT OR DELETE OR UPDATE OF status, playing_area_id, scheduled_date, kickoff_time
  ON public.club_fixtures FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_club_fixture_occupancy();

-- ─── 4. Backfill existing pitched activity (today: 0 sessions, 2 fixtures) ────
INSERT INTO public.pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
SELECT cf.playing_area_id, pa.venue_id,
       tstzrange((cf.scheduled_date + cf.kickoff_time) AT TIME ZONE 'Europe/London',
                 ((cf.scheduled_date + cf.kickoff_time) AT TIME ZONE 'Europe/London') + make_interval(mins => 60), '[)'),
       'club_fixture', cf.id::text, 1, true
FROM public.club_fixtures cf
JOIN public.playing_areas pa ON pa.id = cf.playing_area_id
WHERE cf.playing_area_id IS NOT NULL AND cf.scheduled_date IS NOT NULL AND cf.kickoff_time IS NOT NULL
  AND cf.status IN ('scheduled','completed')
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO public.pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
SELECT cs.playing_area_id, pa.venue_id,
       tstzrange(cs.scheduled_at, cs.scheduled_at + make_interval(mins => 60), '[)'),
       'club_session', cs.id::text, 1, true
FROM public.club_sessions cs
JOIN public.playing_areas pa ON pa.id = cs.playing_area_id
WHERE cs.playing_area_id IS NOT NULL AND cs.scheduled_at IS NOT NULL AND cs.status = 'scheduled'
ON CONFLICT (source_kind, source_id) DO NOTHING;

-- ─── 5. Manager-initials helper (for calendar blocks) ────────────────────────
CREATE OR REPLACE FUNCTION public._club_team_manager_initials(p_team_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT string_agg(
           upper(left(mp.first_name, 1)) || upper(left(COALESCE(mp.last_name, ''), 1)),
           ', ' ORDER BY mp.first_name)
  FROM public.club_team_managers ctm
  JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
  WHERE ctm.team_id = p_team_id AND ctm.is_active = true;
$fn$;
REVOKE ALL     ON FUNCTION public._club_team_manager_initials(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public._club_team_manager_initials(uuid) FROM anon, authenticated;

-- ─── 6. Shared occupancy-detail builder (single source of truth, all 5 kinds) ─
-- Replaces the inline CASE in get_pitch_occupancy so the new operator-wide reader
-- shares the EXACT same per-block detail shape (no drift). Definer-only — called by
-- the SECDEF readers; never directly by anon/authenticated.
CREATE OR REPLACE FUNCTION public._pitch_occupancy_detail(p_kind text, p_source_id text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT CASE p_kind
    WHEN 'fixture' THEN (
      SELECT jsonb_build_object('home_team', th.name, 'away_team', ta.name, 'status', f.status,
        'owed', public._venue_source_owed('fixture', p_source_id))
      FROM public.fixtures f
      LEFT JOIN public.teams th ON th.id = f.home_team_id
      LEFT JOIN public.teams ta ON ta.id = f.away_team_id
      WHERE f.id = p_source_id::uuid)
    WHEN 'booking' THEN (
      SELECT jsonb_build_object(
        'team_id', b.team_id, 'team_name', COALESCE(tb.name, b.booked_by_name),
        'kind', b.kind, 'status', b.status, 'series_id', b.series_id,
        'owed', public._venue_source_owed('booking', p_source_id),
        'is_first', NOT EXISTS (
          SELECT 1 FROM public.pitch_bookings b2
          WHERE b2.venue_id = b.venue_id AND b2.id <> b.id AND b2.created_at < b.created_at
            AND ( (b.team_id IS NOT NULL AND b2.team_id = b.team_id)
               OR (b.team_id IS NULL AND b.booked_by_name IS NOT NULL
                   AND lower(b2.booked_by_name) = lower(b.booked_by_name)) )))
      FROM public.pitch_bookings b
      LEFT JOIN public.teams tb ON tb.id = b.team_id
      WHERE b.id = p_source_id::uuid)
    WHEN 'club_session' THEN (
      SELECT jsonb_build_object(
        'title', cs.title, 'session_type', cs.session_type, 'status', cs.status,
        'team_id', cs.team_id, 'team_name', ct.name,
        'venue_id', cs.venue_id, 'venue_name', sv.name,
        'manager_initials', public._club_team_manager_initials(cs.team_id))
      FROM public.club_sessions cs
      LEFT JOIN public.club_teams ct ON ct.id = cs.team_id
      LEFT JOIN public.venues sv ON sv.id = cs.venue_id
      WHERE cs.id = p_source_id::uuid)
    WHEN 'club_fixture' THEN (
      SELECT jsonb_build_object(
        'our_team', COALESCE(cf.club_team_name, ct.name), 'team_id', cf.club_team_id,
        'opponent', cf.opponent_name, 'is_home', cf.is_home, 'status', cf.status,
        'manager_initials', public._club_team_manager_initials(cf.club_team_id))
      FROM public.club_fixtures cf
      LEFT JOIN public.club_teams ct ON ct.id = cf.club_team_id
      WHERE cf.id = p_source_id::uuid)
    ELSE jsonb_build_object('reason', 'maintenance')
  END;
$fn$;
REVOKE ALL     ON FUNCTION public._pitch_occupancy_detail(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public._pitch_occupancy_detail(text, text) FROM anon, authenticated;

-- ─── 7. get_pitch_occupancy — same output, detail via shared builder + new kinds ─
CREATE OR REPLACE FUNCTION public.get_pitch_occupancy(p_venue_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_range    tstzrange;
  v_result   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'date_range_required' USING ERRCODE = 'P0001';
  END IF;

  v_range := tstzrange(
    (p_from::timestamp) AT TIME ZONE 'Europe/London',
    ((p_to + 1)::timestamp) AT TIME ZONE 'Europe/London', '[)');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', po.id,
    'playing_area_id', po.playing_area_id,
    'pitch_name', pa.name,
    'source_kind', po.source_kind,
    'source_id', po.source_id,
    'priority', po.priority,
    'start', lower(po.time_range),
    'end',   upper(po.time_range),
    'detail', public._pitch_occupancy_detail(po.source_kind, po.source_id)
  ) ORDER BY lower(po.time_range), pa.name), '[]'::jsonb)
  INTO v_result
  FROM pitch_occupancy po
  JOIN playing_areas pa ON pa.id = po.playing_area_id
  WHERE po.venue_id = v_venue_id AND po.active AND po.time_range && v_range;

  RETURN v_result;
END;
$function$;

-- ─── 8. get_operator_pitch_occupancy — unified cross-site calendar feed ───────
-- All venues owned by the caller's operator (venues.company_id, non-null), plus the
-- caller's own venue. Per venue: pitches[] + occupancy[] (same row+detail shape as
-- get_pitch_occupancy). Drives the venue-app ground switcher.
-- Forward consumers (RPCS.md Notes): venue-app BookingsView ground switcher (Phase 3);
-- a future HQ cross-site utilisation view may reuse it — keep the per-venue shape stable.
CREATE OR REPLACE FUNCTION public.get_operator_pitch_occupancy(p_venue_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_company  text;
  v_venue_id text;
  v_range    tstzrange;
  v_result   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'date_range_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT company_id INTO v_company FROM public.venues WHERE id = v_venue_id;

  v_range := tstzrange(
    (p_from::timestamp) AT TIME ZONE 'Europe/London',
    ((p_to + 1)::timestamp) AT TIME ZONE 'Europe/London', '[)');

  SELECT COALESCE(jsonb_agg(vrow ORDER BY vname), '[]'::jsonb) INTO v_result FROM (
    SELECT v.name AS vname, jsonb_build_object(
      'venue_id', v.id,
      'venue_name', v.name,
      'venue_address', NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
      'is_self', (v.id = v_venue_id),
      'pitches', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name)
                         ORDER BY pa.sort_order, pa.name) FILTER (WHERE pa.active), '[]'::jsonb)
        FROM public.playing_areas pa WHERE pa.venue_id = v.id
      ),
      'occupancy', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', po.id,
          'playing_area_id', po.playing_area_id,
          'pitch_name', pa.name,
          'source_kind', po.source_kind,
          'source_id', po.source_id,
          'priority', po.priority,
          'start', lower(po.time_range),
          'end',   upper(po.time_range),
          'detail', public._pitch_occupancy_detail(po.source_kind, po.source_id)
        ) ORDER BY lower(po.time_range), pa.name), '[]'::jsonb)
        FROM public.pitch_occupancy po
        JOIN public.playing_areas pa ON pa.id = po.playing_area_id
        WHERE po.venue_id = v.id AND po.active AND po.time_range && v_range
      )
    ) AS vrow
    FROM public.venues v
    WHERE v.id = v_venue_id
       OR (v_company IS NOT NULL AND v.company_id = v_company)
  ) s;

  RETURN jsonb_build_object('ok', true, 'venues', v_result);
END;
$function$;

REVOKE ALL     ON FUNCTION public.get_operator_pitch_occupancy(text, date, date) FROM public;
GRANT EXECUTE  ON FUNCTION public.get_operator_pitch_occupancy(text, date, date) TO anon, authenticated;

-- Schema cache refresh (PostgREST serves stale signatures after function changes).
SELECT pg_notify('pgrst', 'reload schema');
