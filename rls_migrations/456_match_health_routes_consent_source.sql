-- 456: Match Workout Tracking Phase 1 — storage spine extension
--
-- Builds on mig 375 (match_health_sessions). Phase 1 of the Match Workout Tracking epic
-- (MATCH_WORKOUT_TRACKING_HANDOFF.md): the iPhone reads an Apple Watch "Soccer" workout from
-- Apple Health, matches it to a game, and posts the SUMMARY (+ optional route) to us. We build
-- NO tracking — Apple measures, we read + display. Whole feature ships DARK (every surface
-- self-hides until the native HealthKit ingestion feeds data), so this is prod-safe.
--
-- This migration is ADDITIVE and tier-3 (RLS + special-category health data): drafted by the
-- dev-loop, ephemeral-verified with rollback, but APPLIED ONLY after operator sign-off (gate G1).
--
-- What it does:
--   1. match_health_sessions.source  — 'apple_health_manual' | 'watch_app' (which pipe wrote it).
--   2. NEW match_health_routes        — one route (heatmap track) per session; RLS-on, RPC-only.
--                                       Separate table so stats stay lean + route ages out / cascades.
--   3. players.share_match_fitness    — teammate-sharing consent, DEFAULT false (decision #6).
--   4. _health_is_under_18()          — under-18 guard helper (decision #7); DOB via member_profiles.
--   5. save_match_health_summary      — EXTEND: + p_source, + p_route (writes match_health_routes),
--                                       + under-18 block. Additive params at the end (HR#12 safe).
--                                       DROP the old 11-arg overload (HR: param-type/arity change).
--   6. get_match_health_for_match()   — NEW per-match reader: own row always; teammate rows ONLY
--                                       when match_context='casual' AND that player consented.
--   7. get_match_route()              — NEW heatmap reader: own session only.
--   8. get_my_match_health()          — wording generalised ref→any-player (COMMENT only, no shape change).
--
-- GDPR cascade: match_health_routes.session_id → match_health_sessions(id) ON DELETE CASCADE, so the
-- existing `DELETE FROM match_health_sessions WHERE user_id = v_user_id` in BOTH account-deletion RPCs
-- (mig 375) already purges routes too. The auth.users belt cascade on sessions covers routes as well.
-- No change to the deletion RPCs needed (do not re-CREATE them — avoids drift, HR#11).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. match_health_sessions.source
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE match_health_sessions ADD COLUMN IF NOT EXISTS source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mhs_source_check'
  ) THEN
    ALTER TABLE match_health_sessions
      ADD CONSTRAINT mhs_source_check
      CHECK (source IS NULL OR source IN ('apple_health_manual', 'watch_app'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. match_health_routes — one route per session (heatmap track), RPC-only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_health_routes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES match_health_sessions(id) ON DELETE CASCADE,
  track       jsonb NOT NULL,
  captured_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);

ALTER TABLE match_health_routes ENABLE ROW LEVEL SECURITY;
-- No policies: all access via the SECURITY DEFINER RPCs below (mirrors match_health_sessions / `people`).

CREATE INDEX IF NOT EXISTS idx_mhr_session ON match_health_routes (session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. players.share_match_fitness — teammate-sharing consent (decision #6, default OFF)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE players ADD COLUMN IF NOT EXISTS share_match_fitness boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. _health_is_under_18 — under-18 guard helper (decision #7)
--    Returns true ONLY when DOB is KNOWN and the caller is under 18. DOB-unknown → false
--    (save proceeds; the client confirms 18+ where DOB is unknown). Internal: no role grant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _health_is_under_18(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM member_profiles
     WHERE auth_user_id = p_user_id
       AND dob IS NOT NULL
       AND dob > (current_date - INTERVAL '18 years')
  );
$function$;

REVOKE ALL ON FUNCTION _health_is_under_18(uuid) FROM anon, authenticated, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. save_match_health_summary — EXTEND (+ source, + route, + under-18 block)
--    DROP the old 11-arg overload first: a new arity is a NEW overload, so leaving the old one
--    causes "could not choose best candidate function". DROP then CREATE the 13-arg version.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS save_match_health_summary(text,text,text,int,numeric,numeric,int,int,jsonb,timestamptz,timestamptz);

CREATE OR REPLACE FUNCTION save_match_health_summary(
  p_match_context      text,
  p_match_ref          text,
  p_client_session_id  text,
  p_duration_seconds   int          DEFAULT NULL,
  p_active_energy_kcal numeric      DEFAULT NULL,
  p_distance_meters    numeric      DEFAULT NULL,
  p_avg_hr             int          DEFAULT NULL,
  p_max_hr             int          DEFAULT NULL,
  p_hr_zones           jsonb        DEFAULT NULL,
  p_started_at         timestamptz  DEFAULT NULL,
  p_ended_at           timestamptz  DEFAULT NULL,
  p_source             text         DEFAULT NULL,
  p_route              jsonb        DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id  uuid := auth.uid();
  v_existing uuid;
  v_id       uuid;
  v_updated  boolean;
  v_team_id  text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  -- Decision #7: never gather health data for under-18s where DOB is known.
  IF _health_is_under_18(v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='under_18_health_blocked';
  END IF;
  IF p_match_context IS NULL OR p_match_context NOT IN ('league','casual','cohort') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_match_context';
  END IF;
  IF p_match_ref IS NULL OR p_client_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('apple_health_manual','watch_app') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_source';
  END IF;

  SELECT id INTO v_existing
    FROM match_health_sessions
   WHERE user_id = v_user_id AND client_session_id = p_client_session_id;

  INSERT INTO match_health_sessions (
    user_id, match_context, match_ref, client_session_id,
    duration_seconds, active_energy_kcal, distance_meters,
    avg_hr, max_hr, hr_zones, started_at, ended_at, source
  ) VALUES (
    v_user_id, p_match_context, p_match_ref, p_client_session_id,
    p_duration_seconds, p_active_energy_kcal, p_distance_meters,
    p_avg_hr, p_max_hr, p_hr_zones, p_started_at, p_ended_at, p_source
  )
  ON CONFLICT (user_id, client_session_id) DO UPDATE SET
    match_context      = EXCLUDED.match_context,
    match_ref          = EXCLUDED.match_ref,
    duration_seconds   = EXCLUDED.duration_seconds,
    active_energy_kcal = EXCLUDED.active_energy_kcal,
    distance_meters    = EXCLUDED.distance_meters,
    avg_hr             = EXCLUDED.avg_hr,
    max_hr             = EXCLUDED.max_hr,
    hr_zones           = EXCLUDED.hr_zones,
    started_at         = EXCLUDED.started_at,
    ended_at           = EXCLUDED.ended_at,
    source             = EXCLUDED.source
  RETURNING id INTO v_id;

  v_updated := (v_existing IS NOT NULL);

  -- Optional route (outdoor only; heatmap track). One per session — idempotent upsert so a
  -- re-sync of the same workout updates the track rather than duplicating it.
  IF p_route IS NOT NULL THEN
    INSERT INTO match_health_routes (session_id, track, captured_at)
    VALUES (v_id, p_route, now())
    ON CONFLICT (session_id) DO UPDATE SET
      track       = EXCLUDED.track,
      captured_at = EXCLUDED.captured_at;
  END IF;

  -- Derive an audit team_id (Hard Rule #9). audit_events.team_id is NOT NULL text with NO FK,
  -- so any string is safe; we use the real owning team where we can, else a literal 'health'.
  IF p_match_context = 'casual' THEN
    SELECT team_id INTO v_team_id FROM matches WHERE id = p_match_ref;
  ELSE
    BEGIN
      SELECT home_team_id INTO v_team_id FROM fixtures WHERE id = p_match_ref::uuid;
    EXCEPTION WHEN others THEN
      v_team_id := NULL;
    END;
  END IF;
  v_team_id := COALESCE(v_team_id, 'health');

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'player', v_user_id, 'auth_uid:' || v_user_id::text,
    CASE WHEN v_updated THEN 'match_health_updated' ELSE 'match_health_saved' END,
    'match_health_session', v_id::text,
    jsonb_build_object(
      'match_context', p_match_context,
      'match_ref', p_match_ref,
      'client_session_id', p_client_session_id,
      'source', p_source,
      'has_route', (p_route IS NOT NULL),
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'updated', v_updated);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION save_match_health_summary(text,text,text,int,numeric,numeric,int,int,jsonb,timestamptz,timestamptz,text,jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION save_match_health_summary(text,text,text,int,numeric,numeric,int,int,jsonb,timestamptz,timestamptz,text,jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. get_match_health_for_match — per-match card reader
--    Own row ALWAYS. Teammate rows ONLY when match_context='casual' AND that player has
--    share_match_fitness=true (decision #2 store-now/defer-display + decision #6 consent).
--    League rows are private to the player (a league session's match_ref is a fixtures uuid that
--    never matches matches.id, so the consent-join yields NULL → only the self row returns).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_match_health_for_match(p_match_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_rows    jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_match_ref IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.is_self DESC, r.ended_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id                                   AS session_id,
      (s.user_id = v_user_id)                AS is_self,
      COALESCE(disp.name, 'Player')          AS player_name,
      s.match_context,
      s.duration_seconds,
      s.active_energy_kcal,
      s.distance_meters,
      s.avg_hr,
      s.max_hr,
      s.hr_zones,
      s.source,
      EXISTS (SELECT 1 FROM match_health_routes mr WHERE mr.session_id = s.id) AS has_route,
      s.started_at,
      s.ended_at
    FROM match_health_sessions s
    LEFT JOIN LATERAL (
      SELECT p.name, p.share_match_fitness
        FROM players p
        JOIN team_players tp ON tp.player_id = p.id
        JOIN matches m       ON m.id = s.match_ref AND m.team_id = tp.team_id
       WHERE p.user_id = s.user_id
       LIMIT 1
    ) disp ON true
    WHERE s.match_ref = p_match_ref
      AND (
        s.user_id = v_user_id
        OR (s.match_context = 'casual' AND COALESCE(disp.share_match_fitness, false) = true)
      )
  ) r;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION get_match_health_for_match(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_match_health_for_match(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. get_match_route — heatmap track for one session, OWN session only.
--    Routes are the most sensitive surface (precise GPS), so never exposed to teammates even
--    with share_match_fitness — own only, regardless of consent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_match_route(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_track   jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT mr.track INTO v_track
    FROM match_health_routes mr
    JOIN match_health_sessions s ON s.id = mr.session_id
   WHERE mr.session_id = p_session_id
     AND s.user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'track', COALESCE(v_track, 'null'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION get_match_route(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_match_route(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. get_my_match_health — wording generalised ref→any-player. No shape change (mig 375 body
--    is already player-generic); this only re-documents the consumer set. COMMENT, not re-CREATE.
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON FUNCTION get_my_match_health() IS
  'Read-back of the caller''s own match health sessions for any player (not ref-specific). '
  '{ ok, sessions[], totals }. Consumers: apps/inorout MyIOView "Your match fitness" + per-match card.';

-- Refresh PostgREST so the new/changed RPCs resolve immediately (avoids the 404 cache trap).
SELECT pg_notify('pgrst', 'reload schema');
