-- 084_phase2_venue_league_helpers.sql
--
-- Phase 2 (League Mode) — Cycle 2.1 resolver + realtime helpers.
--
-- Adds four new SECURITY DEFINER helpers that every Phase 2
-- venue_* and league_* RPC will reuse:
--
--   resolve_venue_caller(p_token)
--     — accepts a venue's venue_admin_token OR a platform admin's
--       auth.uid(). Returns the venue_id + actor identification.
--
--   resolve_league_caller(p_token)
--     — accepts a league's league_admin_token, the league's parent
--       venue admin_token (deep-link case), OR platform admin.
--       Returns league_id + venue_id + actor.
--
--   notify_venue_change(p_venue_id, p_reason)
--   notify_league_change(p_league_id, p_reason)
--     — sibling of notify_team_change. Reads venues/leagues
--       .live_channel_key and broadcasts on a venue_live: / league_live:
--       channel. Whitelisted reasons cover every mutating Phase 2
--       RPC; unknown reasons logged with WARNING (matches the team
--       broadcaster's permissive posture per mig 062).
--
-- All four are independent of existing team-scoped helpers.
-- New realtime channel topology (venue_live: / league_live:) does
-- not overlap team_live: subscribers in App.jsx.

------------------------------------------------------------------
-- resolve_venue_caller
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_venue_caller(p_token text)
RETURNS TABLE(venue_id text, actor_type text, actor_ident text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Stage 1: venue_admin_token of a venue
  IF p_token IS NOT NULL THEN
    RETURN QUERY
      SELECT v.id::text,
             'venue_admin'::text,
             ('venue_admin_token:' || md5(p_token))::text
      FROM venues v
      WHERE v.venue_admin_token = p_token
        AND v.active = true
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Stage 2: authenticated platform admin (operator-led onboarding;
  -- caller passes NULL p_token, identity comes from auth.uid()).
  -- Platform admins can resolve ANY venue but the body of the
  -- calling RPC must supply venue_id (e.g. via a separate param).
  -- Here we return a sentinel with NULL venue_id; callers that
  -- need a specific venue handle it explicitly.
  IF v_uid IS NOT NULL AND public.is_platform_admin() THEN
    RETURN QUERY
      SELECT NULL::text,
             'platform_admin'::text,
             ('user_id:' || v_uid::text)::text;
    RETURN;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_venue_caller(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_venue_caller(text)
  TO anon, authenticated, service_role;

------------------------------------------------------------------
-- resolve_league_caller
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_league_caller(p_token text)
RETURNS TABLE(league_id text, venue_id text, actor_type text, actor_ident text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_token IS NOT NULL THEN
    -- Stage 1: league_admin_token of a league
    RETURN QUERY
      SELECT l.id::text,
             l.venue_id::text,
             'league_admin'::text,
             ('league_admin_token:' || md5(p_token))::text
      FROM leagues l
      WHERE l.league_admin_token = p_token
        AND l.active = true
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Stage 2: venue_admin_token of the league's parent venue.
    -- Returns NULL league_id; caller must scope.
    RETURN QUERY
      SELECT NULL::text,
             v.id::text,
             'venue_admin'::text,
             ('venue_admin_token:' || md5(p_token))::text
      FROM venues v
      WHERE v.venue_admin_token = p_token
        AND v.active = true
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Stage 3: platform admin
  IF v_uid IS NOT NULL AND public.is_platform_admin() THEN
    RETURN QUERY
      SELECT NULL::text,
             NULL::text,
             'platform_admin'::text,
             ('user_id:' || v_uid::text)::text;
    RETURN;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_league_caller(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_league_caller(text)
  TO anon, authenticated, service_role;

------------------------------------------------------------------
-- notify_venue_change
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime, pg_temp
AS $function$
DECLARE
  v_channel_key text;
  v_known_reasons text[] := ARRAY[
    'venue_created',
    'venue_updated',
    'season_created',
    'season_updated',
    'fixtures_generated',
    'fixture_scheduled',
    'fixture_status_changed',
    'fixture_postponed',
    'fixture_voided',
    'fixture_walkover',
    'fixture_forfeit',
    'ref_assigned',
    'ref_changed',
    'ref_no_show',
    'ref_added',
    'ref_updated',
    'pitch_assigned',
    'pitch_added',
    'pitch_updated',
    'pitch_closed',
    'team_registration_pending',
    'team_approved',
    'team_rejected',
    'team_withdrew',
    'incident_flagged'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_venue_change: unknown reason "%" for venue "%"',
      p_reason, p_venue_id;
  END IF;

  SELECT live_channel_key INTO v_channel_key
  FROM venues WHERE id = p_venue_id;

  IF v_channel_key IS NULL THEN RETURN; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type',   'venue_state_changed',
      'reason', p_reason,
      'at',     extract(epoch from now())
    ),
    'broadcast',
    'venue_live:' || v_channel_key,
    false  -- public broadcast so anon clients can subscribe
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_venue_change(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_venue_change(text, text)
  TO anon, authenticated, service_role;

------------------------------------------------------------------
-- notify_league_change
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_league_change(p_league_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime, pg_temp
AS $function$
DECLARE
  v_channel_key text;
  v_known_reasons text[] := ARRAY[
    'league_created',
    'league_updated',
    'season_created',
    'fixtures_generated',
    'fixture_status_changed',
    'standings_updated',
    'team_registration_pending',
    'team_approved',
    'team_rejected',
    'team_withdrew',
    'squad_mode_locked'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_league_change: unknown reason "%" for league "%"',
      p_reason, p_league_id;
  END IF;

  SELECT live_channel_key INTO v_channel_key
  FROM leagues WHERE id = p_league_id;

  IF v_channel_key IS NULL THEN RETURN; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type',   'league_state_changed',
      'reason', p_reason,
      'at',     extract(epoch from now())
    ),
    'broadcast',
    'league_live:' || v_channel_key,
    false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_league_change(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_league_change(text, text)
  TO anon, authenticated, service_role;
