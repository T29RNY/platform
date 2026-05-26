-- 085_phase2_superadmin_create_venue.sql
--
-- Phase 2 (League Mode) — Cycle 2.1 onboarding tool.
--
-- superadmin_create_venue is the operator-led venue onboarding RPC.
-- Self-serve signup is deferred (originally Phase 8, now year 2 per
-- session 48 decision). Until then, every new venue is created by
-- a platform admin via the apps/superadmin dashboard.
--
-- Signature:
--   superadmin_create_venue(
--     p_name           text,                  -- venue display name
--     p_operator_email text,                  -- contact_email
--     p_sport          text DEFAULT 'football',
--     p_first_league   jsonb DEFAULT NULL     -- optional: create first league
--   ) RETURNS jsonb
--
-- p_first_league shape (all optional, defaults applied server-side):
--   {
--     "name":            "Tuesday 5-a-side",
--     "format":          "5-a-side",          -- default '5-a-side'
--     "day_of_week":     2,                   -- 0=Sun..6=Sat
--     "default_kickoff": "19:30"              -- HH:MM
--   }
--
-- Returns:
--   {
--     "ok":           true,
--     "venue_id":     "...",
--     "venue_token":  "...",
--     "venue_url":    "/venue/<token>",
--     "league_id":    "..." | null,
--     "league_token": "..." | null,
--     "league_code":  "..." | null,
--     "league_url":   "/join/<code>" | null
--   }
--
-- Security:
--   - SECURITY DEFINER, gated by is_platform_admin().
--   - Anon callers always rejected with 'not_platform_admin'.
--   - On success, audits to audit_events (entity_type='venue').

CREATE OR REPLACE FUNCTION public.superadmin_create_venue(
  p_name           text,
  p_operator_email text,
  p_sport          text DEFAULT 'football',
  p_first_league   jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue_id text;
  v_venue_token text;
  v_league_id text;
  v_league_token text;
  v_league_code text;
  v_league_name text;
  v_league_format text;
  v_league_day int;
  v_league_kickoff time;
BEGIN
  -- Auth gate
  IF v_uid IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin' USING ERRCODE = 'P0001';
  END IF;

  -- Input validation
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'venue_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_operator_email IS NULL OR p_operator_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'operator_email_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- Create venue.
  -- venue.id is a text PK; mirrors teams.id convention (a slug-style
  -- short id). We derive from gen_random_uuid first 12 chars to keep
  -- it URL-friendly and globally unique.
  v_venue_id := 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  INSERT INTO public.venues (
    id, name, sport, contact_email, active, subscription_status
  )
  VALUES (
    v_venue_id, trim(p_name), p_sport, lower(trim(p_operator_email)),
    true, 'trial'
  )
  RETURNING venue_admin_token INTO v_venue_token;

  -- Optionally create the first league
  IF p_first_league IS NOT NULL THEN
    v_league_name    := COALESCE(p_first_league->>'name', trim(p_name) || ' League');
    v_league_format  := COALESCE(p_first_league->>'format', '5-a-side');
    v_league_day     := NULLIF(p_first_league->>'day_of_week', '')::int;
    v_league_kickoff := NULLIF(p_first_league->>'default_kickoff', '')::time;

    v_league_id := 'l_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

    INSERT INTO public.leagues (
      id, venue_id, name, sport, format,
      day_of_week, default_kickoff_time,
      active
    )
    VALUES (
      v_league_id, v_venue_id, v_league_name, p_sport, v_league_format,
      v_league_day, v_league_kickoff,
      true
    )
    RETURNING league_admin_token, league_code INTO v_league_token, v_league_code;
  END IF;

  -- Audit
  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id,                       -- audit_events.team_id is the
                                      -- scoping id; venues use venue_id here
    v_uid, 'platform_admin', 'user_id:' || v_uid::text,
    'venue_created', 'venue', v_venue_id,
    jsonb_build_object(
      'venue_name', trim(p_name),
      'operator_email', lower(trim(p_operator_email)),
      'sport', p_sport,
      'league_created', (v_league_id IS NOT NULL),
      'league_id', v_league_id,
      'league_code', v_league_code
    )
  );

  -- Broadcast
  PERFORM public.notify_venue_change(v_venue_id, 'venue_created');
  IF v_league_id IS NOT NULL THEN
    PERFORM public.notify_league_change(v_league_id, 'league_created');
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'venue_id',     v_venue_id,
    'venue_token',  v_venue_token,
    'venue_url',    '/venue/' || v_venue_token,
    'league_id',    v_league_id,
    'league_token', v_league_token,
    'league_code',  v_league_code,
    'league_url',   CASE WHEN v_league_code IS NOT NULL
                         THEN '/join/' || v_league_code
                         ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.superadmin_create_venue(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.superadmin_create_venue(text, text, text, jsonb)
  TO authenticated;
