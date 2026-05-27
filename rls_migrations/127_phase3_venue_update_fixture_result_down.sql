-- Reverts mig 127.
--
-- Drops venue_update_fixture_result. Reverts notify_venue_change to
-- mig 121's body (a Phase 3-only whitelist — drops the Phase 2
-- reasons mig 127 restored). Reverts notify_league_change to mig
-- 101's body (no 'fixture_result_corrected').
--
-- NOTE: reverting puts the pre-existing mig 121 regression back in
-- place (notify_venue_change WARNINGs on Phase 2 reasons). Acceptable
-- because a down migration must be a strict revert of its up; the
-- regression-fix is a side-effect of 127 that goes away with 127.

DROP FUNCTION IF EXISTS public.venue_update_fixture_result(text, uuid, integer, integer, text);

CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    'match_started',
    'match_event_recorded',
    'match_result_saved'
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
    false
  );
END;
$function$;

REVOKE ALL     ON FUNCTION public.notify_venue_change(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_venue_change(text, text) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_league_change(p_league_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key text;
  v_known_reasons text[] := ARRAY[
    'league_created',
    'league_updated',
    'season_created',
    'fixtures_generated',
    'fixtures_cascaded',
    'fixture_status_changed',
    'standings_updated',
    'team_registration_pending',
    'team_approved',
    'team_rejected',
    'team_withdrew',
    'team_expelled',
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

REVOKE ALL     ON FUNCTION public.notify_league_change(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_league_change(text, text) FROM anon, authenticated;
