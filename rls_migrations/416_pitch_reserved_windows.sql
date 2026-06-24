-- 416_pitch_reserved_windows.sql
-- Pitch priority (pilot backlog #5 + #6) — PHASE 1: reserved-window foundation.
-- Config + display ONLY. NO enforcement, NO rank bumping (that is Phase 2 / mig 417).
--
-- A reserved window declares "this pitch, this weekday, this time band is held for
-- our own club use" with an audience:
--   internal  → any of the club's teams (no specific team)
--   team      → one named club_team (club_team_id)
--   min_rank  → club teams ranked at least this good (min_rank; lower number = higher)
-- Phase 1 writes NO pitch_occupancy rows — windows are advisory shading on the
-- venue calendar + a config surface. Enforcement (block external bookings) and the
-- rank-driven bump land in Phase 2.

CREATE TABLE public.pitch_reserved_windows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playing_area_id uuid NOT NULL REFERENCES public.playing_areas(id) ON DELETE CASCADE,
  venue_id        text NOT NULL REFERENCES public.venues(id),
  day_of_week     smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  audience        text NOT NULL CHECK (audience IN ('internal','team','min_rank')),
  club_team_id    uuid REFERENCES public.club_teams(id) ON DELETE CASCADE,
  min_rank        int,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prw_time_order CHECK (start_time < end_time),
  CONSTRAINT prw_audience_shape CHECK (
    (audience = 'team'     AND club_team_id IS NOT NULL AND min_rank IS NULL) OR
    (audience = 'min_rank' AND min_rank     IS NOT NULL AND club_team_id IS NULL) OR
    (audience = 'internal' AND club_team_id IS NULL AND min_rank IS NULL)
  )
);

CREATE INDEX idx_prw_pitch ON public.pitch_reserved_windows(playing_area_id);

ALTER TABLE public.pitch_reserved_windows ENABLE ROW LEVEL SECURITY;
-- RPC-only: no direct client access (writes/reads go through the SECDEF RPCs below).
REVOKE ALL ON public.pitch_reserved_windows FROM anon, authenticated;

-- ── WRITE: replace-set a pitch's reserved windows ───────────────────────────
CREATE OR REPLACE FUNCTION public.venue_set_pitch_reserved_windows(
  p_venue_token text, p_pitch_id uuid, p_windows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_pitch    record;
  v_w        jsonb;
  v_audience text;
  v_team     uuid;
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

  IF p_pitch_id IS NULL THEN
    RAISE EXCEPTION 'pitch_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, venue_id INTO v_pitch FROM playing_areas WHERE id = p_pitch_id;
  IF v_pitch.id IS NULL THEN
    RAISE EXCEPTION 'pitch_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_pitch.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'pitch_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  IF p_windows IS NULL OR jsonb_typeof(p_windows) <> 'array' THEN
    RAISE EXCEPTION 'windows_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- validate every row before mutating
  FOR v_w IN SELECT * FROM jsonb_array_elements(p_windows) LOOP
    IF (v_w->>'day_of_week') IS NULL OR (v_w->>'day_of_week') !~ '^[0-9]+$'
       OR (v_w->>'day_of_week')::int < 0 OR (v_w->>'day_of_week')::int > 6 THEN
      RAISE EXCEPTION 'reserved_window_day_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF (v_w->>'start_time') IS NULL OR (v_w->>'end_time') IS NULL THEN
      RAISE EXCEPTION 'reserved_window_times_required' USING ERRCODE = 'P0001';
    END IF;
    IF (v_w->>'start_time')::time >= (v_w->>'end_time')::time THEN
      RAISE EXCEPTION 'reserved_window_times_inverted' USING ERRCODE = 'P0001';
    END IF;
    v_audience := v_w->>'audience';
    IF v_audience IS NULL OR v_audience NOT IN ('internal','team','min_rank') THEN
      RAISE EXCEPTION 'reserved_window_audience_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF v_audience = 'team' THEN
      v_team := NULLIF(v_w->>'club_team_id', '')::uuid;
      IF v_team IS NULL THEN
        RAISE EXCEPTION 'reserved_window_team_required' USING ERRCODE = 'P0001';
      END IF;
      -- the picked team must belong to a club hosted at THIS venue
      IF NOT EXISTS (
        SELECT 1 FROM public.club_teams ct
        JOIN public.club_venues cv ON cv.club_id = ct.club_id
        WHERE ct.id = v_team AND cv.venue_id = v_venue_id
      ) THEN
        RAISE EXCEPTION 'reserved_window_team_not_hosted' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_audience = 'min_rank' THEN
      IF (v_w->>'min_rank') IS NULL OR (v_w->>'min_rank') !~ '^[0-9]+$'
         OR (v_w->>'min_rank')::int < 1 THEN
        RAISE EXCEPTION 'reserved_window_rank_invalid' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  -- replace-set for this pitch
  DELETE FROM public.pitch_reserved_windows WHERE playing_area_id = p_pitch_id;
  FOR v_w IN SELECT * FROM jsonb_array_elements(p_windows) LOOP
    v_audience := v_w->>'audience';
    INSERT INTO public.pitch_reserved_windows
      (playing_area_id, venue_id, day_of_week, start_time, end_time,
       audience, club_team_id, min_rank, note)
    VALUES (
      p_pitch_id, v_venue_id,
      (v_w->>'day_of_week')::int, (v_w->>'start_time')::time, (v_w->>'end_time')::time,
      v_audience,
      CASE WHEN v_audience = 'team'     THEN NULLIF(v_w->>'club_team_id', '')::uuid ELSE NULL END,
      CASE WHEN v_audience = 'min_rank' THEN (v_w->>'min_rank')::int ELSE NULL END,
      NULLIF(trim(v_w->>'note'), '')
    );
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (
    v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
    'pitch_reserved_windows_set', 'playing_area', p_pitch_id::text,
    jsonb_build_object('venue_id', v_venue_id, 'count', v_count, 'windows', p_windows)
  );

  PERFORM public.notify_venue_change(v_venue_id, 'pitch_reserved_windows_set');

  RETURN jsonb_build_object('ok', true, 'pitch_id', p_pitch_id, 'count', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_set_pitch_reserved_windows(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_set_pitch_reserved_windows(text, uuid, jsonb) TO anon, authenticated;

-- ── READ: every reserved window across the operator's same-company venues ────
CREATE OR REPLACE FUNCTION public.venue_list_pitch_reserved_windows(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_company  text;
  v_result   jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  SELECT company_id INTO v_company FROM public.venues WHERE id = v_venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',             rw.id,
    'playing_area_id', rw.playing_area_id,
    'venue_id',       rw.venue_id,
    'day_of_week',    rw.day_of_week,
    'start_time',     to_char(rw.start_time, 'HH24:MI'),
    'end_time',       to_char(rw.end_time, 'HH24:MI'),
    'audience',       rw.audience,
    'club_team_id',   rw.club_team_id,
    'club_team_name', ct.name,
    'min_rank',       rw.min_rank,
    'note',           rw.note
  ) ORDER BY rw.playing_area_id, rw.day_of_week, rw.start_time), '[]'::jsonb)
  INTO v_result
  FROM public.pitch_reserved_windows rw
  JOIN public.venues v ON v.id = rw.venue_id
  LEFT JOIN public.club_teams ct ON ct.id = rw.club_team_id
  WHERE v.id = v_venue_id OR (v_company IS NOT NULL AND v.company_id = v_company);

  RETURN jsonb_build_object('ok', true, 'windows', v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_pitch_reserved_windows(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_pitch_reserved_windows(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
