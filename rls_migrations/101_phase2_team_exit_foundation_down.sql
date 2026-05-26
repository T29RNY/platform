-- 101_phase2_team_exit_foundation_down.sql
--
-- Reverses 101. Drops the expulsion_reason column and restores the
-- pre-2.5b notify_*_change whitelists (which lacked
-- 'fixtures_cascaded' and 'team_expelled').

ALTER TABLE public.competition_teams DROP COLUMN IF EXISTS expulsion_reason;

-- Restore notify_venue_change pre-2.5b whitelist
CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime, pg_temp
AS $function$
DECLARE
  v_channel_key text;
  v_known_reasons text[] := ARRAY[
    'venue_created','venue_updated',
    'season_created','season_updated',
    'fixtures_generated',
    'fixture_scheduled','fixture_status_changed',
    'fixture_postponed','fixture_voided','fixture_walkover','fixture_forfeit',
    'ref_assigned','ref_changed','ref_no_show','ref_added','ref_updated',
    'pitch_assigned','pitch_added','pitch_updated','pitch_closed',
    'team_registration_pending','team_approved','team_rejected','team_withdrew',
    'incident_flagged'
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

CREATE OR REPLACE FUNCTION public.notify_league_change(p_league_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime, pg_temp
AS $function$
DECLARE
  v_channel_key text;
  v_known_reasons text[] := ARRAY[
    'league_created','league_updated','season_created','fixtures_generated',
    'fixture_status_changed','standings_updated',
    'team_registration_pending','team_approved','team_rejected','team_withdrew',
    'squad_mode_locked'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_league_change: unknown reason "%" for league "%"', p_reason, p_league_id;
  END IF;
  SELECT live_channel_key INTO v_channel_key FROM leagues WHERE id = p_league_id;
  IF v_channel_key IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    jsonb_build_object('type','league_state_changed','reason',p_reason,'at',extract(epoch from now())),
    'broadcast', 'league_live:' || v_channel_key, false);
END;
$function$;
