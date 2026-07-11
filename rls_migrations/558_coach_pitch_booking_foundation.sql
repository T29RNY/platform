-- 558_coach_pitch_booking_foundation.sql
-- Coach self-service pitch booking — Phase 1 foundation (PR #1).
--
-- Decouples PITCH allocation from SESSION visibility (operator decision 5b), adds
-- variable duration (decision B), booking provenance, and a coach-callable pitch-
-- availability reader (coaches have no venue token, so cannot use get_pitch_occupancy).
--
-- SAFE-BY-DEFAULT: the new columns default to TODAY's behaviour
--   pitch_status DEFAULT 'allocated', duration_mins DEFAULT 60
-- so ALTER…ADD backfills every existing row and every unmodified insert path
-- (venue-created sessions) keeps reserving byte-identical. The ONLY behaviour change
-- to the shipped engine is the occupancy trigger's reserve predicate (+pitch_status)
-- and the duration source (+duration_mins). _reserve_club_occupancy (the bump path)
-- is deliberately NOT touched here — the bump-visibility rewrite is deferred to PR #3.
-- club_fixtures untouched (decision C: matches are club_session session_type='match').
--
-- Proof: ephemeral-verify (mig applied to a throwaway _e2e_ fixture) MUST show:
--   existing scheduled+pitched sessions still reserve; a 90-min booking reserves 90m;
--   pitch_status='requested' reserves nothing but the session still lists as scheduled;
--   the reader rejects a non-manager / a venue not linked to the coach's club, and
--   returns ONLY opaque busy blocks (no team names / no owed amounts).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Decouple pitch from session on club_sessions
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.club_sessions
  -- pitch allocation state, SEPARATE from session status (which stays 'scheduled'
  -- so the session keeps showing to players/guardians even while the pitch is pending)
  ADD COLUMN IF NOT EXISTS pitch_status text NOT NULL DEFAULT 'allocated'
    CHECK (pitch_status IN ('none','requested','allocated','declined','expired')),
  -- booking provenance — widen-able free text (venue|coach|referee|league|api|…)
  ADD COLUMN IF NOT EXISTS booking_origin text NOT NULL DEFAULT 'venue',
  -- which member (coach) self-booked it; NULL for venue-created sessions
  ADD COLUMN IF NOT EXISTS booked_by_profile_id uuid
    REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  -- variable-length booking (decision B); trigger builds the occupancy range from this
  ADD COLUMN IF NOT EXISTS duration_mins int NOT NULL DEFAULT 60
    CHECK (duration_mins > 0 AND duration_mins <= 1440);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Occupancy trigger: reserve only when pitch_status='allocated', use duration
--    (was: reserve on scheduled+pitch+time, hard-coded 60 min — mig 417)
-- ════════════════════════════════════════════════════════════════════════════
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
     AND NEW.scheduled_at IS NOT NULL
     AND NEW.pitch_status = 'allocated' THEN
    SELECT pa.venue_id INTO v_venue_id FROM public.playing_areas pa WHERE pa.id = NEW.playing_area_id;
    IF v_venue_id IS NULL THEN
      UPDATE public.pitch_occupancy SET active = false
        WHERE source_kind = 'club_session' AND source_id = NEW.id::text;
      RETURN NEW;
    END IF;
    v_start := NEW.scheduled_at;
    v_range := tstzrange(v_start, v_start + make_interval(mins => COALESCE(NEW.duration_mins, 60)), '[)');
    PERFORM public._reserve_club_occupancy('club_session', NEW.id::text, NEW.playing_area_id, v_venue_id, v_range, NEW.team_id);
  ELSE
    -- cancelled / tentative / pitch cleared / venue cleared / pitch_status not allocated
    -- (requested / declined / none) → release the slot; session row stays visible.
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_session' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Surface pitch_status + booking_origin + duration on the club_session detail
--    block (HR#12: flows to all 3 occupancy readers + the bookingUtil.js mapper,
--    updated in the same commit). Additive keys only — shape preserved.
-- ════════════════════════════════════════════════════════════════════════════
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
        'team_id', cs.team_id, 'team_name', ct.name, 'priority_rank', ct.priority_rank,
        'venue_id', cs.venue_id, 'venue_name', sv.name,
        'manager_initials', public._club_team_manager_initials(cs.team_id),
        -- NEW (mig 558): decoupled pitch state + provenance + duration
        'pitch_status', cs.pitch_status, 'booking_origin', cs.booking_origin,
        'duration_mins', cs.duration_mins)
      FROM public.club_sessions cs
      LEFT JOIN public.club_teams ct ON ct.id = cs.team_id
      LEFT JOIN public.venues sv ON sv.id = cs.venue_id
      WHERE cs.id = p_source_id::uuid)
    WHEN 'club_fixture' THEN (
      SELECT jsonb_build_object(
        'our_team', COALESCE(cf.club_team_name, ct.name), 'team_id', cf.club_team_id,
        'priority_rank', ct.priority_rank,
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

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Coach-callable pitch-availability reader
--    Auth: auth.uid() → member_profiles → active club_team_manager of p_team_id
--          → target venue must be in the team's club's club_venues (ANY linked ground;
--          a DIRECT club_venues check, NOT _venue_in_club_operator — that helper also
--          requires venues.company_id, which would wrongly block a single-venue club).
--    Privacy: returns ONLY opaque busy blocks (pitch + from/to). It deliberately does
--    NOT call _pitch_occupancy_detail — that carries other teams' names + `owed`
--    amounts (a cross-org finance/PII leak). The coach only needs "is this slot free?".
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_manager_pitch_availability(
  p_team_id uuid, p_venue_id text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_club    text;
  v_range   tstzrange;
  v_pitches jsonb;
  v_busy    jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;

  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p_team_id AND member_profile_id = v_profile AND is_active = true
  ) THEN
    RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club FROM public.club_teams WHERE id = p_team_id;
  IF v_club IS NULL THEN RAISE EXCEPTION 'team_not_found' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = v_club AND venue_id = p_venue_id
  ) THEN
    RAISE EXCEPTION 'venue_not_in_club' USING ERRCODE = 'P0001';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'date_range_required' USING ERRCODE = 'P0001';
  END IF;

  v_range := tstzrange(
    (p_from::timestamp) AT TIME ZONE 'Europe/London',
    ((p_to + 1)::timestamp) AT TIME ZONE 'Europe/London', '[)');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name) ORDER BY pa.name), '[]'::jsonb)
    INTO v_pitches
    FROM public.playing_areas pa
    WHERE pa.venue_id = p_venue_id AND pa.active AND pa.is_available;

  -- Opaque busy blocks only — pitch + interval, NO detail (no names, no money).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'playing_area_id', po.playing_area_id,
      'start', lower(po.time_range),
      'end',   upper(po.time_range)
    ) ORDER BY lower(po.time_range)), '[]'::jsonb)
    INTO v_busy
    FROM public.pitch_occupancy po
    WHERE po.venue_id = p_venue_id AND po.active AND po.time_range && v_range;

  RETURN jsonb_build_object('ok', true, 'venue_id', p_venue_id, 'pitches', v_pitches, 'busy', v_busy);
END;
$fn$;
REVOKE ALL     ON FUNCTION public.club_manager_pitch_availability(uuid, text, date, date) FROM public;
REVOKE EXECUTE ON FUNCTION public.club_manager_pitch_availability(uuid, text, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.club_manager_pitch_availability(uuid, text, date, date) TO authenticated;

-- PostgREST schema cache refresh (new function signature)
SELECT pg_notify('pgrst', 'reload schema');
