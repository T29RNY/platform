-- 417_pitch_priority_enforcement.sql
-- Pitch priority (pilot backlog #5 + #6) — PHASE 2: enforcement + rank bumping.
-- Builds on mig 416 (reserved-window config/display) + mig 414 (occupancy triggers).
--
-- TWO behaviours go live here:
--   (#5) EXTERNAL GATE — reserved windows now actually block outside hires.
--        book_pitch_adhoc / book_pitch_series (casual/external, auth.uid) → new error
--        'slot_reserved' when the requested time lands in a window they don't qualify for.
--        venue_create_booking / venue_create_booking_series (operator, venue token) →
--        warning-only (returns warning:'reserved', still books — operator override).
--        Internal club activity is NOT gated by windows at create time (locked decision A):
--        internal-vs-internal contention is rank-bump only; windows protect club time from
--        EXTERNAL hire and act as skip-zones in the reallocation search.
--   (#6) RANK BUMP — club-session/club-fixture occupancy resolution is now rank-aware.
--        On a clash with another CLUB activity, the team with the WORSE priority_rank yields:
--        the incumbent goes 'tentative', releases its pitch, gets the closest free slot across
--        the operator's same-company venues (skipping non-qualifying reserved windows) stored
--        as a pitch_bump_proposal, and its managers are alerted via the club_announcements
--        spine. Equal/NULL/worse incoming rank, or a non-club incumbent → today's
--        'slot_unavailable' (no bump). Bumping is club-vs-club ONLY — a paying outside hire is
--        never auto-evicted.
--
-- Mechanism keeps the mig-414 per-table trigger shape (no release path missed); the triggers
-- now delegate the reserve to a shared SECDEF resolver _reserve_club_occupancy.

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Allow the new 'tentative' status on bumped club events (writes no occupancy)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.club_sessions DROP CONSTRAINT club_sessions_status_check;
ALTER TABLE public.club_sessions ADD CONSTRAINT club_sessions_status_check
  CHECK (status = ANY (ARRAY['scheduled'::text,'cancelled'::text,'tentative'::text]));
ALTER TABLE public.club_fixtures DROP CONSTRAINT club_fixtures_status_check;
ALTER TABLE public.club_fixtures ADD CONSTRAINT club_fixtures_status_check
  CHECK (status = ANY (ARRAY['scheduled'::text,'completed'::text,'postponed'::text,'void'::text,'tentative'::text]));

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Bump-proposal store (suggested relocation + tentative-resolution state)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pitch_bump_proposals (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind                text NOT NULL CHECK (event_kind IN ('club_session','club_fixture')),
  event_id                  uuid NOT NULL,
  club_team_id              uuid REFERENCES public.club_teams(id) ON DELETE CASCADE,
  club_id                   text,
  original_playing_area_id  uuid,
  original_venue_id         text,
  original_start            timestamptz,
  suggested_playing_area_id uuid,
  suggested_venue_id        text,
  suggested_start           timestamptz,
  bumped_by_kind            text,
  bumped_by_id              text,
  status                    text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','accepted','declined','expired','superseded')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  resolved_at               timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pbp_event ON public.pitch_bump_proposals(event_kind, event_id);
CREATE INDEX IF NOT EXISTS idx_pbp_team_pending ON public.pitch_bump_proposals(club_team_id) WHERE status = 'pending';

ALTER TABLE public.pitch_bump_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pitch_bump_proposals FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Reserved-window overlap helper (weekly band ↔ concrete tstzrange)
-- ════════════════════════════════════════════════════════════════════════════
-- A reserved window is a weekly band (day_of_week + start_time..end_time, Europe/London).
-- Bookings are short; we expand the requested range across the (1-2) local dates it spans.
CREATE OR REPLACE FUNCTION public._reserved_window_overlaps(
  p_dow smallint, p_start time, p_end time, p_lo timestamptz, p_hi timestamptz)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  d          date;
  v_lo_local date := (p_lo AT TIME ZONE 'Europe/London')::date;
  v_hi_local date := (p_hi AT TIME ZONE 'Europe/London')::date;
BEGIN
  d := v_lo_local;
  WHILE d <= v_hi_local LOOP
    IF EXTRACT(DOW FROM d)::int = p_dow THEN
      IF tstzrange((d + p_start) AT TIME ZONE 'Europe/London',
                   (d + p_end)   AT TIME ZONE 'Europe/London', '[)')
         && tstzrange(p_lo, p_hi, '[)') THEN
        RETURN true;
      END IF;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN false;
END;
$fn$;
REVOKE ALL     ON FUNCTION public._reserved_window_overlaps(smallint, time, time, timestamptz, timestamptz) FROM public;
REVOKE EXECUTE ON FUNCTION public._reserved_window_overlaps(smallint, time, time, timestamptz, timestamptz) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Does any reserved window BLOCK this requester for this pitch+range?
-- ════════════════════════════════════════════════════════════════════════════
-- Returns the blocking window (jsonb) or NULL.
--   audience='internal'  → qualifies internal kinds (club_session/club_fixture); blocks external.
--   audience='team'      → qualifies only the named team's own internal activity.
--   audience='min_rank'  → qualifies internal activity whose team rank is good enough (<= min_rank).
-- p_requester_team_id is the locked-decision-1 extension to the handoff's 4-arg signature so a
-- team's OWN window is not treated as off-limits in the reallocation search; external callers
-- pass NULL kind='booking' → blocked by every audience.
CREATE OR REPLACE FUNCTION public._pitch_window_blocks(
  p_pitch_id uuid, p_range tstzrange, p_requester_kind text,
  p_requester_rank int DEFAULT NULL, p_requester_team_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_lo       timestamptz := lower(p_range);
  v_hi       timestamptz := upper(p_range);
  v_internal boolean := p_requester_kind IN ('club_session','club_fixture');
  v_w        record;
  v_qualifies boolean;
BEGIN
  IF p_pitch_id IS NULL OR v_lo IS NULL OR v_hi IS NULL THEN RETURN NULL; END IF;
  FOR v_w IN
    SELECT * FROM public.pitch_reserved_windows WHERE playing_area_id = p_pitch_id
  LOOP
    IF NOT public._reserved_window_overlaps(v_w.day_of_week, v_w.start_time, v_w.end_time, v_lo, v_hi) THEN
      CONTINUE;
    END IF;
    v_qualifies := CASE v_w.audience
      WHEN 'internal' THEN v_internal
      WHEN 'team'     THEN v_internal AND p_requester_team_id IS NOT NULL AND p_requester_team_id = v_w.club_team_id
      WHEN 'min_rank' THEN v_internal AND p_requester_rank IS NOT NULL AND p_requester_rank <= v_w.min_rank
      ELSE false
    END;
    IF NOT v_qualifies THEN
      RETURN jsonb_build_object(
        'id', v_w.id, 'audience', v_w.audience, 'club_team_id', v_w.club_team_id,
        'min_rank', v_w.min_rank, 'day_of_week', v_w.day_of_week,
        'start_time', to_char(v_w.start_time,'HH24:MI'), 'end_time', to_char(v_w.end_time,'HH24:MI'));
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$;
REVOKE ALL     ON FUNCTION public._pitch_window_blocks(uuid, tstzrange, text, int, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public._pitch_window_blocks(uuid, tstzrange, text, int, uuid) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Closest available alternative slot for a bumped team
-- ════════════════════════════════════════════════════════════════════════════
-- Searches the SAME LOCAL DATE as the original, 30-min steps 06:00..22:00, across every
-- active pitch in the operator's same-company venues. Skips slots that overlap live occupancy
-- or a reserved window the bumped team doesn't qualify for. Nearest-in-time wins; same venue
-- breaks ties. Returns {playing_area_id, venue_id, start} or NULL.
-- NOTE: same-date bound is a deliberate pilot simplification — widenable to ±N days later.
CREATE OR REPLACE FUNCTION public._closest_available_slot(
  p_kind text, p_team_id uuid, p_rank int,
  p_orig_pitch uuid, p_orig_venue text, p_orig_start timestamptz, p_duration_min int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_company text;
  v_day0    timestamp;   -- local midnight of the original date (naive)
  v_dur     int := COALESCE(NULLIF(p_duration_min,0), 60);
  v_best    record;
BEGIN
  IF p_orig_start IS NULL THEN RETURN NULL; END IF;
  SELECT company_id INTO v_company FROM public.venues WHERE id = p_orig_venue;
  v_day0 := date_trunc('day', (p_orig_start AT TIME ZONE 'Europe/London'));

  SELECT pitch_id, venue_id, cand_start INTO v_best FROM (
    SELECT pa.id AS pitch_id, pa.venue_id,
           ((v_day0 + make_interval(mins => g)) AT TIME ZONE 'Europe/London') AS cand_start
    FROM public.playing_areas pa
    JOIN public.venues v ON v.id = pa.venue_id
    CROSS JOIN generate_series(360, 1320, 30) AS g
    WHERE pa.active AND pa.is_available
      AND (v.id = p_orig_venue OR (v_company IS NOT NULL AND v.company_id = v_company))
  ) cand
  WHERE NOT (cand.pitch_id = p_orig_pitch AND cand.cand_start = p_orig_start)
    AND NOT EXISTS (
      SELECT 1 FROM public.pitch_occupancy po
      WHERE po.playing_area_id = cand.pitch_id AND po.active
        AND po.time_range && tstzrange(cand.cand_start, cand.cand_start + make_interval(mins => v_dur), '[)'))
    AND public._pitch_window_blocks(
          cand.pitch_id, tstzrange(cand.cand_start, cand.cand_start + make_interval(mins => v_dur), '[)'),
          p_kind, p_rank, p_team_id) IS NULL
  ORDER BY abs(extract(epoch FROM cand.cand_start - p_orig_start)),
           (cand.venue_id <> p_orig_venue), cand.cand_start
  LIMIT 1;

  IF v_best.pitch_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('playing_area_id', v_best.pitch_id, 'venue_id', v_best.venue_id, 'start', v_best.cand_start);
END;
$fn$;
REVOKE ALL     ON FUNCTION public._closest_available_slot(text, uuid, int, uuid, text, timestamptz, int) FROM public;
REVOKE EXECUTE ON FUNCTION public._closest_available_slot(text, uuid, int, uuid, text, timestamptz, int) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Plain occupancy upsert (shared by both triggers via the resolver)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._upsert_club_occupancy(
  p_kind text, p_source_id text, p_pitch uuid, p_venue text, p_range tstzrange)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  INSERT INTO public.pitch_occupancy
    (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
  VALUES (p_pitch, p_venue, p_range, p_kind, p_source_id, 1, true)
  ON CONFLICT (source_kind, source_id) DO UPDATE
    SET playing_area_id = EXCLUDED.playing_area_id,
        venue_id        = EXCLUDED.venue_id,
        time_range      = EXCLUDED.time_range,
        priority        = 1,
        active          = true;
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
END;
$fn$;
REVOKE ALL     ON FUNCTION public._upsert_club_occupancy(text, text, uuid, text, tstzrange) FROM public;
REVOKE EXECUTE ON FUNCTION public._upsert_club_occupancy(text, text, uuid, text, tstzrange) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Bump notification (reuse the club_announcements spine; Hard Rule #9 audit)
-- ════════════════════════════════════════════════════════════════════════════
-- club_teams have no realtime channel (notify_team_change is casual-teams only), so a bumped
-- club team's managers are reached via a team-scoped club_announcement (mirrors
-- club_manager_send_announcement) + a venue-console realtime nudge.
CREATE OR REPLACE FUNCTION public._notify_bump(p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  p          record;
  v_team     text;
  v_ann_venue text;
  v_pitch    text;
  v_venue    text;
  v_body     text;
BEGIN
  SELECT * INTO p FROM public.pitch_bump_proposals WHERE id = p_proposal_id;
  IF p.id IS NULL THEN RETURN; END IF;
  SELECT name INTO v_team FROM public.club_teams WHERE id = p.club_team_id;
  SELECT venue_id INTO v_ann_venue FROM public.club_venues WHERE club_id = p.club_id ORDER BY created_at LIMIT 1;

  IF p.suggested_start IS NOT NULL THEN
    SELECT pa.name, v.name INTO v_pitch, v_venue
      FROM public.playing_areas pa JOIN public.venues v ON v.id = pa.venue_id
      WHERE pa.id = p.suggested_playing_area_id;
    v_body := COALESCE(v_team,'Your team') || '''s booking was moved by a higher-priority team. '
              || 'Closest available: ' || COALESCE(v_pitch,'a pitch') || ' at ' || COALESCE(v_venue,'the venue')
              || ', ' || to_char(p.suggested_start AT TIME ZONE 'Europe/London', 'Dy DD Mon HH24:MI')
              || '. Open the team to Accept or Decline.';
  ELSE
    v_body := COALESCE(v_team,'Your team') || '''s booking was moved by a higher-priority team and '
              || 'needs a new slot. No automatic alternative was found — please re-book as soon as possible.';
  END IF;

  IF v_ann_venue IS NOT NULL THEN
    INSERT INTO public.club_announcements (club_id, venue_id, created_by, title, body, audience, cohort_id, team_id)
    VALUES (p.club_id, v_ann_venue, NULL, 'Pitch change needed', v_body, 'team', NULL, p.club_team_id);
  END IF;

  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', NULL, 'system', 'pitch_priority', 'pitch_bump_proposed', 'pitch_bump_proposal', p_proposal_id::text,
    jsonb_build_object('event_kind', p.event_kind, 'event_id', p.event_id, 'club_team_id', p.club_team_id,
      'suggested_pitch', p.suggested_playing_area_id, 'suggested_start', p.suggested_start,
      'bumped_by', p.bumped_by_kind || ':' || p.bumped_by_id));

  IF p.original_venue_id IS NOT NULL THEN
    PERFORM public.notify_venue_change(p.original_venue_id, 'pitch_bump_proposed');
  END IF;
END;
$fn$;
REVOKE ALL     ON FUNCTION public._notify_bump(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public._notify_bump(uuid) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Rank-aware reserve resolver (called by both occupancy triggers)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._reserve_club_occupancy(
  p_kind text, p_source_id text, p_pitch uuid, p_venue text, p_range tstzrange, p_team_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_incoming_rank int;
  v_conf          record;
  v_loser_team    uuid;
  v_loser_rank    int;
  v_loser_dur     int;
  v_club          text;
  v_sugg          jsonb;
  v_prop_id       uuid;
BEGIN
  SELECT priority_rank INTO v_incoming_rank FROM public.club_teams WHERE id = p_team_id;

  -- The EXCLUDE constraint guarantees at most ONE active overlapping row on this pitch.
  SELECT * INTO v_conf FROM public.pitch_occupancy po
   WHERE po.playing_area_id = p_pitch AND po.active AND po.time_range && p_range
     AND NOT (po.source_kind = p_kind AND po.source_id = p_source_id)
   LIMIT 1;

  IF v_conf.id IS NULL THEN
    PERFORM public._upsert_club_occupancy(p_kind, p_source_id, p_pitch, p_venue, p_range);
    RETURN;
  END IF;

  -- Bumping is club-vs-club ONLY — never evict an outside hire / league fixture / maintenance.
  IF v_conf.source_kind NOT IN ('club_session','club_fixture') THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_conf.source_kind = 'club_session' THEN
    SELECT team_id INTO v_loser_team FROM public.club_sessions WHERE id = v_conf.source_id::uuid;
  ELSE
    SELECT club_team_id INTO v_loser_team FROM public.club_fixtures WHERE id = v_conf.source_id::uuid;
  END IF;
  SELECT priority_rank INTO v_loser_rank FROM public.club_teams WHERE id = v_loser_team;

  -- Rank decides, not arrival. Incoming wins ONLY if both ranks are set and incoming is
  -- strictly better (lower number). Equal / NULL / worse → today's behaviour, no bump.
  IF v_incoming_rank IS NULL OR v_loser_rank IS NULL OR v_incoming_rank >= v_loser_rank THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- ── BUMP the incumbent ──────────────────────────────────────────────────
  v_loser_dur := (extract(epoch FROM (upper(v_conf.time_range) - lower(v_conf.time_range))) / 60)::int;

  -- 1) release the incumbent's pitch
  UPDATE public.pitch_occupancy SET active = false WHERE id = v_conf.id;

  -- 2) flip the event tentative (its own trigger re-releases occupancy idempotently)
  IF v_conf.source_kind = 'club_session' THEN
    UPDATE public.club_sessions SET status = 'tentative' WHERE id = v_conf.source_id::uuid;
    SELECT club_id INTO v_club FROM public.club_sessions WHERE id = v_conf.source_id::uuid;
  ELSE
    UPDATE public.club_fixtures SET status = 'tentative' WHERE id = v_conf.source_id::uuid;
    SELECT club_id INTO v_club FROM public.club_teams WHERE id = v_loser_team;
  END IF;

  -- 3) reserve the WINNER first, so its slot is excluded from the suggestion search
  PERFORM public._upsert_club_occupancy(p_kind, p_source_id, p_pitch, p_venue, p_range);

  -- 4) compute the closest alternative for the bumped team (winner now holds the slot)
  v_sugg := public._closest_available_slot(
              v_conf.source_kind, v_loser_team, v_loser_rank,
              v_conf.playing_area_id, v_conf.venue_id, lower(v_conf.time_range), v_loser_dur);

  -- 5) supersede any prior pending proposal for this event, then store the new one
  UPDATE public.pitch_bump_proposals SET status = 'superseded', resolved_at = now()
    WHERE event_kind = v_conf.source_kind AND event_id = v_conf.source_id::uuid AND status = 'pending';

  INSERT INTO public.pitch_bump_proposals
    (event_kind, event_id, club_team_id, club_id,
     original_playing_area_id, original_venue_id, original_start,
     suggested_playing_area_id, suggested_venue_id, suggested_start,
     bumped_by_kind, bumped_by_id, status)
  VALUES
    (v_conf.source_kind, v_conf.source_id::uuid, v_loser_team, v_club,
     v_conf.playing_area_id, v_conf.venue_id, lower(v_conf.time_range),
     NULLIF(v_sugg->>'playing_area_id','')::uuid, v_sugg->>'venue_id', (v_sugg->>'start')::timestamptz,
     p_kind, p_source_id, 'pending')
  RETURNING id INTO v_prop_id;

  -- 6) notify the bumped team (reuse comms spine) + audit
  PERFORM public._notify_bump(v_prop_id);
END;
$fn$;
REVOKE ALL     ON FUNCTION public._reserve_club_occupancy(text, text, uuid, text, tstzrange, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public._reserve_club_occupancy(text, text, uuid, text, tstzrange, uuid) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Rewrite the two occupancy triggers to delegate to the resolver
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
     AND NEW.scheduled_at IS NOT NULL THEN
    SELECT pa.venue_id INTO v_venue_id FROM public.playing_areas pa WHERE pa.id = NEW.playing_area_id;
    IF v_venue_id IS NULL THEN
      UPDATE public.pitch_occupancy SET active = false
        WHERE source_kind = 'club_session' AND source_id = NEW.id::text;
      RETURN NEW;
    END IF;
    v_start := NEW.scheduled_at;
    v_range := tstzrange(v_start, v_start + make_interval(mins => 60), '[)');
    PERFORM public._reserve_club_occupancy('club_session', NEW.id::text, NEW.playing_area_id, v_venue_id, v_range, NEW.team_id);
  ELSE
    -- cancelled / tentative / pitch cleared / venue cleared → release the slot
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_session' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

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
    PERFORM public._reserve_club_occupancy('club_fixture', NEW.id::text, NEW.playing_area_id, v_venue_id, v_range, NEW.club_team_id);
  ELSE
    -- postponed / void / tentative / pitch cleared → release the slot
    UPDATE public.pitch_occupancy SET active = false
      WHERE source_kind = 'club_fixture' AND source_id = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. EXTERNAL GATE — block casual/external bookings on reserved windows
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.book_pitch_adhoc(p_team_id text, p_playing_area_id uuid, p_booking_date date, p_kickoff_time time without time zone, p_slot_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue_id text;
  v_slot int;
  v_start timestamptz;
  v_booking_id uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NULL OR p_playing_area_id IS NULL OR p_booking_date IS NULL OR p_kickoff_time IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = p_team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not_team_admin' USING ERRCODE = 'P0001';
  END IF;

  SELECT pa.venue_id INTO v_venue_id
  FROM playing_areas pa JOIN venues v ON v.id = pa.venue_id
  WHERE pa.id = p_playing_area_id AND pa.active AND pa.is_available
    AND v.bookings_enabled AND v.active;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'pitch_unavailable' USING ERRCODE = 'P0001', DETAIL = p_playing_area_id::text;
  END IF;

  v_slot := COALESCE(p_slot_minutes, 60);
  v_start := (p_booking_date + p_kickoff_time) AT TIME ZONE 'Europe/London';

  -- #5 external gate: outside hires cannot book into a reserved window.
  IF public._pitch_window_blocks(p_playing_area_id,
       tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', NULL, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'slot_reserved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO pitch_bookings (id, team_id, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status)
  VALUES (v_booking_id, p_team_id, v_venue_id, p_playing_area_id, p_booking_date, p_kickoff_time, v_slot, 'adhoc', 'requested');

  BEGIN
    INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 3, true);
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (p_team_id, v_uid, 'team_admin', 'user_id:' || v_uid::text, 'booking_requested', 'pitch_booking', v_booking_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'playing_area_id', p_playing_area_id, 'booking_date', p_booking_date,
                       'kickoff_time', p_kickoff_time, 'slot_minutes', v_slot, 'kind', 'adhoc'));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_requested');
  PERFORM public.notify_team_change(p_team_id, 'booking_requested');

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', 'requested', 'kind', 'adhoc');
END;
$function$;

CREATE OR REPLACE FUNCTION public.book_pitch_series(p_team_id text, p_playing_area_id uuid, p_kickoff_time time without time zone, p_start_date date, p_weeks integer, p_slot_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue_id text;
  v_slot int;
  v_dow smallint;
  v_series_id uuid := gen_random_uuid();
  v_i int;
  v_date date;
  v_start timestamptz;
  v_booking_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001'; END IF;
  IF p_team_id IS NULL OR p_playing_area_id IS NULL OR p_kickoff_time IS NULL OR p_start_date IS NULL THEN
    RAISE EXCEPTION 'booking_args_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_weeks IS NULL OR p_weeks < 1 OR p_weeks > 52 THEN
    RAISE EXCEPTION 'weeks_out_of_range' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_admins WHERE team_id = p_team_id AND user_id = v_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'not_team_admin' USING ERRCODE = 'P0001';
  END IF;

  SELECT pa.venue_id INTO v_venue_id
  FROM playing_areas pa JOIN venues v ON v.id = pa.venue_id
  WHERE pa.id = p_playing_area_id AND pa.active AND pa.is_available
    AND v.bookings_enabled AND v.active;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'pitch_unavailable' USING ERRCODE = 'P0001', DETAIL = p_playing_area_id::text;
  END IF;

  v_slot := COALESCE(p_slot_minutes, 60);
  v_dow  := EXTRACT(DOW FROM p_start_date)::smallint;

  INSERT INTO booking_series (id, team_id, venue_id, playing_area_id, day_of_week, kickoff_time, slot_minutes, status, ends_on)
  VALUES (v_series_id, p_team_id, v_venue_id, p_playing_area_id, v_dow, p_kickoff_time, v_slot, 'active', p_start_date + (p_weeks - 1) * 7);

  BEGIN
    FOR v_i IN 0 .. (p_weeks - 1) LOOP
      v_date := p_start_date + v_i * 7;
      v_start := (v_date + p_kickoff_time) AT TIME ZONE 'Europe/London';
      -- #5 external gate: refuse the whole series if any week lands in a reserved window.
      IF public._pitch_window_blocks(p_playing_area_id,
           tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', NULL, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'slot_reserved' USING ERRCODE = 'P0001', DETAIL = v_date::text;
      END IF;
      v_booking_id := gen_random_uuid();
      INSERT INTO pitch_bookings (id, team_id, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, kind, status, series_id)
      VALUES (v_booking_id, p_team_id, v_venue_id, p_playing_area_id, v_date, p_kickoff_time, v_slot, 'block', 'requested', v_series_id);
      INSERT INTO pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
      VALUES (p_playing_area_id, v_venue_id, tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', v_booking_id::text, 2, true);
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001', DETAIL = v_date::text;
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (p_team_id, v_uid, 'team_admin', 'user_id:' || v_uid::text, 'booking_requested', 'booking_series', v_series_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'playing_area_id', p_playing_area_id, 'day_of_week', v_dow,
                       'kickoff_time', p_kickoff_time, 'slot_minutes', v_slot, 'weeks', p_weeks, 'start_date', p_start_date, 'kind', 'block'));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_requested');
  PERFORM public.notify_team_change(p_team_id, 'booking_requested');

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'weeks', p_weeks, 'status', 'requested', 'kind', 'block');
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. OPERATOR OVERRIDE — warning-only on reserved windows (still books)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.venue_create_booking(p_venue_token text, p_playing_area_id uuid, p_booking_date date, p_kickoff_time time without time zone, p_slot_minutes integer DEFAULT NULL::integer, p_team_id text DEFAULT NULL::text, p_booked_by_name text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_slot int;
  v_start timestamptz;
  v_booking_id uuid := gen_random_uuid();
  v_email text := NULLIF(btrim(p_contact_email),'');
  v_phone text := NULLIF(btrim(p_contact_phone),'');
  v_warning text := NULL;
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

  -- #5 operator override: warn (not block) when booking into a reserved window.
  IF public._pitch_window_blocks(p_playing_area_id,
       tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', NULL, NULL) IS NOT NULL THEN
    v_warning := 'reserved';
  END IF;

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
                       'booked_by_name', NULLIF(trim(p_booked_by_name),''), 'contact_email', v_email, 'contact_phone', v_phone,
                       'reserved_override', (v_warning IS NOT NULL)));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  IF p_team_id IS NOT NULL THEN PERFORM public.notify_team_change(p_team_id, 'booking_confirmed'); END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', 'confirmed', 'kind', 'adhoc', 'warning', v_warning);
END;
$function$;

CREATE OR REPLACE FUNCTION public.venue_create_booking_series(p_venue_token text, p_playing_area_id uuid, p_kickoff_time time without time zone, p_start_date date, p_weeks integer, p_team_id text, p_slot_minutes integer DEFAULT NULL::integer, p_contact_email text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  v_warning text := NULL;
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
      -- #5 operator override: warn (not block) if any week lands in a reserved window.
      IF v_warning IS NULL AND public._pitch_window_blocks(p_playing_area_id,
           tstzrange(v_start, v_start + make_interval(mins => v_slot), '[)'), 'booking', NULL, NULL) IS NOT NULL THEN
        v_warning := 'reserved';
      END IF;
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
                       'kind', 'block', 'contact_email', v_email, 'contact_phone', v_phone, 'reserved_override', (v_warning IS NOT NULL)));

  PERFORM public.notify_venue_change(v_venue_id, 'booking_confirmed');
  PERFORM public.notify_team_change(p_team_id, 'booking_confirmed');

  RETURN jsonb_build_object('ok', true, 'series_id', v_series_id, 'weeks', p_weeks, 'status', 'confirmed', 'kind', 'block', 'warning', v_warning);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Extend notify_venue_change known reasons (bump events)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    'venue_created','venue_updated','season_created','season_updated',
    'fixtures_generated','fixtures_cascaded','fixture_scheduled','fixture_status_changed',
    'fixture_postponed','fixture_voided','fixture_walkover','fixture_forfeit',
    'ref_assigned','ref_changed','ref_no_show','ref_added','ref_updated',
    'pitch_assigned','pitch_added','pitch_updated','pitch_closed',
    'team_registration_pending','team_approved','team_rejected','team_withdrew','team_expelled',
    'incident_flagged',
    'match_started','match_event_recorded','match_result_saved',
    'result_corrected',
    'incident_resolved',
    'booking_requested','booking_confirmed','booking_declined','booking_cancelled','booking_superseded',
    'payment_recorded','payment_voided','charge_updated',
    'customer_self_signup','customer_approved',
    'pitch_bump_proposed','pitch_bump_resolved'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_venue_change: unknown reason "%" for venue "%"', p_reason, p_venue_id;
  END IF;
  SELECT live_channel_key INTO v_channel_key FROM venues WHERE id = p_venue_id;
  IF v_channel_key IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    jsonb_build_object('type','venue_state_changed','reason',p_reason,'at',extract(epoch from now())),
    'broadcast', 'venue_live:' || v_channel_key, false);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. Apply a bump resolution (shared by manager + venue variants)
-- ════════════════════════════════════════════════════════════════════════════
-- Caller does auth, then delegates here. Accept → move event to the suggested slot (its trigger
-- re-reserves; on race it re-suggests and stays pending). Decline → event stays tentative.
CREATE OR REPLACE FUNCTION public._apply_bump_resolution(
  p_proposal_id uuid, p_action text, p_actor_type text, p_actor_ident text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  p        record;
  v_rank   int;
  v_dur    int;
  v_sugg   jsonb;
BEGIN
  SELECT * INTO p FROM public.pitch_bump_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'proposal_not_pending' USING ERRCODE = 'P0001'; END IF;

  IF p_action = 'decline' THEN
    UPDATE public.pitch_bump_proposals SET status = 'declined', resolved_at = now() WHERE id = p_proposal_id;
    INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES ('_system', auth.uid(), p_actor_type, p_actor_ident, 'pitch_bump_declined', 'pitch_bump_proposal', p_proposal_id::text,
      jsonb_build_object('event_kind', p.event_kind, 'event_id', p.event_id, 'club_team_id', p.club_team_id));
    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  IF p_action <> 'accept' THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE = 'P0001'; END IF;
  IF p.suggested_start IS NULL OR p.suggested_playing_area_id IS NULL THEN
    RAISE EXCEPTION 'no_suggestion' USING ERRCODE = 'P0001';
  END IF;

  -- Try to move the event onto the suggested slot. The event's trigger re-reserves occupancy
  -- and raises slot_unavailable if it was taken in the meantime → we re-suggest, stay pending.
  BEGIN
    IF p.event_kind = 'club_session' THEN
      UPDATE public.club_sessions
        SET status = 'scheduled', playing_area_id = p.suggested_playing_area_id,
            venue_id = p.suggested_venue_id, scheduled_at = p.suggested_start
        WHERE id = p.event_id;
    ELSE
      UPDATE public.club_fixtures
        SET status = 'scheduled', playing_area_id = p.suggested_playing_area_id,
            scheduled_date = (p.suggested_start AT TIME ZONE 'Europe/London')::date,
            kickoff_time   = (p.suggested_start AT TIME ZONE 'Europe/London')::time
        WHERE id = p.event_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'slot_unavailable' THEN
      SELECT priority_rank INTO v_rank FROM public.club_teams WHERE id = p.club_team_id;
      v_dur := COALESCE((extract(epoch FROM (
                 CASE WHEN p.event_kind='club_session' THEN interval '60 minutes' ELSE interval '60 minutes' END)) / 60)::int, 60);
      v_sugg := public._closest_available_slot(p.event_kind, p.club_team_id, v_rank,
                  p.original_playing_area_id, p.original_venue_id, p.original_start, 60);
      UPDATE public.pitch_bump_proposals
        SET suggested_playing_area_id = NULLIF(v_sugg->>'playing_area_id','')::uuid,
            suggested_venue_id        = v_sugg->>'venue_id',
            suggested_start           = (v_sugg->>'start')::timestamptz
        WHERE id = p_proposal_id;
      INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
      VALUES ('_system', auth.uid(), p_actor_type, p_actor_ident, 'pitch_bump_resuggested', 'pitch_bump_proposal', p_proposal_id::text,
        jsonb_build_object('event_kind', p.event_kind, 'event_id', p.event_id, 'new_suggestion', v_sugg));
      RETURN jsonb_build_object('ok', false, 'retry', true, 'reason', 'slot_taken', 'suggestion', v_sugg);
    END IF;
    RAISE;
  END;

  UPDATE public.pitch_bump_proposals SET status = 'accepted', resolved_at = now() WHERE id = p_proposal_id;
  INSERT INTO public.audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES ('_system', auth.uid(), p_actor_type, p_actor_ident, 'pitch_bump_accepted', 'pitch_bump_proposal', p_proposal_id::text,
    jsonb_build_object('event_kind', p.event_kind, 'event_id', p.event_id, 'club_team_id', p.club_team_id,
      'moved_to_pitch', p.suggested_playing_area_id, 'moved_to_start', p.suggested_start));
  IF p.original_venue_id IS NOT NULL THEN PERFORM public.notify_venue_change(p.original_venue_id, 'pitch_bump_resolved'); END IF;
  IF p.suggested_venue_id IS NOT NULL AND p.suggested_venue_id <> COALESCE(p.original_venue_id,'') THEN
    PERFORM public.notify_venue_change(p.suggested_venue_id, 'pitch_bump_resolved');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'accepted',
    'playing_area_id', p.suggested_playing_area_id, 'start', p.suggested_start);
END;
$fn$;
REVOKE ALL     ON FUNCTION public._apply_bump_resolution(uuid, text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public._apply_bump_resolution(uuid, text, text, text) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. Public accept/decline RPCs — manager (auth.uid) + venue (token)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_manager_resolve_bump(p_proposal_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile record;
  p         record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id, first_name, last_name INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO p FROM public.pitch_bump_proposals WHERE id = p_proposal_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_team_managers
    WHERE team_id = p.club_team_id AND member_profile_id = v_profile.id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_a_manager' USING ERRCODE = 'P0001'; END IF;

  RETURN public._apply_bump_resolution(p_proposal_id, p_action, 'player',
           v_profile.first_name || ' ' || COALESCE(v_profile.last_name, ''));
END;
$fn$;
REVOKE ALL     ON FUNCTION public.club_manager_resolve_bump(uuid, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.club_manager_resolve_bump(uuid, text) FROM anon;
GRANT EXECUTE  ON FUNCTION public.club_manager_resolve_bump(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.venue_resolve_bump(p_venue_token text, p_proposal_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_company text;
  p         record;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO p FROM public.pitch_bump_proposals WHERE id = p_proposal_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0001'; END IF;

  -- the proposal's venue must belong to the caller's operator (same company or the venue itself)
  SELECT company_id INTO v_company FROM public.venues WHERE id = v_caller.venue_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.venues v
    WHERE v.id = p.original_venue_id
      AND (v.id = v_caller.venue_id OR (v_company IS NOT NULL AND v.company_id = v_company))
  ) THEN RAISE EXCEPTION 'proposal_not_in_operator' USING ERRCODE = 'P0001'; END IF;

  RETURN public._apply_bump_resolution(p_proposal_id, p_action, v_caller.actor_type, v_caller.actor_ident);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.venue_resolve_bump(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_resolve_bump(text, uuid, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. Readers — pending bump proposals (manager + venue surfaces, Phase 3 UI)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.club_manager_list_bump_proposals()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile record;
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile FROM public.member_profiles WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'proposals', '[]'::jsonb); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pbp.id, 'event_kind', pbp.event_kind, 'event_id', pbp.event_id,
    'club_team_id', pbp.club_team_id, 'club_team_name', ct.name,
    'original_start', pbp.original_start,
    'suggested_playing_area_id', pbp.suggested_playing_area_id, 'suggested_pitch_name', pa.name,
    'suggested_venue_id', pbp.suggested_venue_id, 'suggested_venue_name', v.name,
    'suggested_start', pbp.suggested_start, 'created_at', pbp.created_at
  ) ORDER BY pbp.created_at DESC), '[]'::jsonb) INTO v_result
  FROM public.pitch_bump_proposals pbp
  JOIN public.club_team_managers ctm ON ctm.team_id = pbp.club_team_id AND ctm.is_active = true
  LEFT JOIN public.club_teams ct ON ct.id = pbp.club_team_id
  LEFT JOIN public.playing_areas pa ON pa.id = pbp.suggested_playing_area_id
  LEFT JOIN public.venues v ON v.id = pbp.suggested_venue_id
  WHERE ctm.member_profile_id = v_profile.id AND pbp.status = 'pending';

  RETURN jsonb_build_object('ok', true, 'proposals', v_result);
END;
$fn$;
REVOKE ALL     ON FUNCTION public.club_manager_list_bump_proposals() FROM public;
REVOKE EXECUTE ON FUNCTION public.club_manager_list_bump_proposals() FROM anon;
GRANT EXECUTE  ON FUNCTION public.club_manager_list_bump_proposals() TO authenticated;

CREATE OR REPLACE FUNCTION public.venue_list_bump_proposals(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_company text;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  SELECT company_id INTO v_company FROM public.venues WHERE id = v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pbp.id, 'event_kind', pbp.event_kind, 'event_id', pbp.event_id,
    'club_team_id', pbp.club_team_id, 'club_team_name', ct.name,
    'original_venue_id', pbp.original_venue_id, 'original_start', pbp.original_start,
    'suggested_playing_area_id', pbp.suggested_playing_area_id, 'suggested_pitch_name', pa.name,
    'suggested_venue_id', pbp.suggested_venue_id, 'suggested_venue_name', sv.name,
    'suggested_start', pbp.suggested_start, 'created_at', pbp.created_at
  ) ORDER BY pbp.created_at DESC), '[]'::jsonb) INTO v_result
  FROM public.pitch_bump_proposals pbp
  JOIN public.venues ov ON ov.id = pbp.original_venue_id
  LEFT JOIN public.club_teams ct ON ct.id = pbp.club_team_id
  LEFT JOIN public.playing_areas pa ON pa.id = pbp.suggested_playing_area_id
  LEFT JOIN public.venues sv ON sv.id = pbp.suggested_venue_id
  WHERE pbp.status = 'pending'
    AND (ov.id = v_caller.venue_id OR (v_company IS NOT NULL AND ov.company_id = v_company));

  RETURN jsonb_build_object('ok', true, 'proposals', v_result);
END;
$fn$;
REVOKE ALL    ON FUNCTION public.venue_list_bump_proposals(text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_bump_proposals(text) TO anon, authenticated;

-- Schema cache refresh (PostgREST serves stale signatures after function changes).
SELECT pg_notify('pgrst', 'reload schema');
