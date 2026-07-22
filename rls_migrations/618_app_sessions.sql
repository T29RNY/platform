-- 618_app_sessions.sql
--
-- First-party, minimal, operational session record — the thing that answers
-- "did this named person open the app, on what device, how long, and where did
-- they get to?" without a PostHog query or a 7-day log dig. This is what keeps
-- the Sessions view useful under opt-in analytics: it is NOT gated on analytics
-- consent, because it is a first-party operational record held under legitimate
-- interest (disclosed on the Legal page, mig-PR #5), shared with nobody, pruned
-- at 90 days and on account deletion.
--
-- Deliberately minimal: no PII beyond the opaque auth uuid, no free text, no
-- event stream, no message content. `last_route` is a route TYPE (e.g. 'hub',
-- 'player'), never a URL that could carry a token. One row per client session,
-- upserted — NOT one row per screen (that would be 20-40x the volume).
--
-- Why a new table, not audit_events: a session row must be UPDATEd (last_seen,
-- screen_count) and audit_events is immutable by design with a NOT NULL team_id
-- that a squad-less operator has not got. See the telemetry handoff.

CREATE TABLE IF NOT EXISTS public.app_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_session_id  text NOT NULL UNIQUE,   -- client-generated; the upsert key
  user_id            uuid,                    -- auth.uid() when signed in; else NULL
  actor_hash         text,                    -- SHA-256 of the player token for anon (matches the PostHog distinct_id); never the raw token
  app                text NOT NULL DEFAULT 'inorout',
  team_id            text,                    -- denormalised context, all nullable (a squad-less owner has none)
  club_id            text,
  venue_id           text,
  route_type         text,                    -- landing route type
  last_route         text,                    -- last route TYPE reached (the "got as far as"); never a URL
  active_hat         text,                    -- operator | club_admin | team_manager | member | guardian | ...
  display_mode       text,                    -- standalone | browser
  platform           text,                    -- native | web
  screen_count       int  NOT NULL DEFAULT 1,
  started_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_started      ON public.app_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user         ON public.app_sessions (user_id, started_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_sessions_venue        ON public.app_sessions (venue_id, started_at DESC) WHERE venue_id IS NOT NULL;

-- RLS on, NO policy, REVOKE from anon+authenticated. All access is via the
-- SECURITY DEFINER RPCs below (writes) and the is_platform_admin()-gated reader.
-- (feedback_default_privileges_revoke: revoke the NAMED roles, not just PUBLIC.)
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_sessions FROM PUBLIC, anon, authenticated;


-- ─── log_session_ping ────────────────────────────────────────────────────────
-- Fire-and-forget upsert, one row per client session. Anon or authenticated.
-- Derives user_id from auth.uid() server-side (never trusts a passed id). The
-- app_sessions row IS the server-side trace for this write (Hard Rule 9's intent
-- — a durable record of the client action — satisfied by the row itself; an
-- audit_events insert per ping would be wrong at this volume).
CREATE OR REPLACE FUNCTION public.log_session_ping(
  p_session_id   text,
  p_route_type   text     DEFAULT NULL,
  p_last_route   text     DEFAULT NULL,
  p_active_hat   text     DEFAULT NULL,
  p_platform     text     DEFAULT NULL,
  p_display_mode text     DEFAULT NULL,
  p_actor_hash   text     DEFAULT NULL,
  p_team_id      text     DEFAULT NULL,
  p_club_id      text     DEFAULT NULL,
  p_venue_id     text     DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_session_id IS NULL OR length(p_session_id) = 0 THEN RETURN; END IF;

  INSERT INTO public.app_sessions (
    client_session_id, user_id, actor_hash, app,
    team_id, club_id, venue_id,
    route_type, last_route, active_hat, display_mode, platform,
    screen_count, started_at, last_seen_at
  ) VALUES (
    p_session_id, v_uid, p_actor_hash, 'inorout',
    p_team_id, p_club_id, p_venue_id,
    p_route_type, p_last_route, p_active_hat, p_display_mode, p_platform,
    1, now(), now()
  )
  ON CONFLICT (client_session_id) DO UPDATE SET
    last_seen_at = now(),
    screen_count = public.app_sessions.screen_count + 1,
    last_route   = COALESCE(EXCLUDED.last_route, public.app_sessions.last_route),
    active_hat   = COALESCE(EXCLUDED.active_hat, public.app_sessions.active_hat),
    user_id      = COALESCE(EXCLUDED.user_id,    public.app_sessions.user_id),
    team_id      = COALESCE(EXCLUDED.team_id,    public.app_sessions.team_id),
    club_id      = COALESCE(EXCLUDED.club_id,    public.app_sessions.club_id),
    venue_id     = COALESCE(EXCLUDED.venue_id,   public.app_sessions.venue_id);
EXCEPTION
  WHEN OTHERS THEN
    NULL;  -- fire-and-forget: never surface an analytics write to the user
END;
$$;

REVOKE ALL ON FUNCTION public.log_session_ping(text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_session_ping(text, text, text, text, text, text, text, text, text, text) TO anon, authenticated;


-- ─── superadmin_recent_sessions ──────────────────────────────────────────────
-- Named-session reader for the superadmin Sessions view. Resolves the display
-- name server-side (user_id → user_profiles.display_name, else auth.users email
-- local-part) — the whole point: PostHog can only show an opaque id, our DB can
-- show a name. Platform-admin gated. Excludes demo/dc teams like the other
-- superadmin readers. STABLE.
CREATE OR REPLACE FUNCTION public.superadmin_recent_sessions(
  p_limit int DEFAULT 100,
  p_since timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      a.id,
      a.user_id,
      COALESCE(
        up.display_name,
        split_part(u.email, '@', 1),
        CASE WHEN a.user_id IS NULL THEN 'Anonymous' ELSE 'Unknown' END
      )                                                   AS who,
      a.app,
      a.platform,
      a.display_mode,
      a.team_id, a.club_id, a.venue_id,
      a.route_type,
      a.last_route,
      a.active_hat,
      a.screen_count,
      a.started_at,
      a.last_seen_at,
      GREATEST(0, EXTRACT(EPOCH FROM (a.last_seen_at - a.started_at)))::int AS duration_seconds
    FROM public.app_sessions a
    LEFT JOIN public.user_profiles up ON up.user_id = a.user_id
    LEFT JOIN auth.users u             ON u.id      = a.user_id
    WHERE (p_since IS NULL OR a.started_at >= p_since)
      AND COALESCE(a.team_id, '') NOT LIKE 'team_demo%'
      AND COALESCE(a.team_id, '') NOT LIKE 'team_dc%'
    ORDER BY a.started_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
  ) s;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_recent_sessions(int, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_recent_sessions(int, timestamptz) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
