-- 101_phase2_team_exit_foundation.sql
--
-- Phase 2 (League Mode) — Cycle 2.5b foundation for mid-season
-- team-exit flows (withdraw + expel).
--
--   competition_teams.expulsion_reason (additive nullable). Mirrors
--   the existing withdrawal_reason / rejection_reason columns so
--   each terminal status has its own reason field.
--
--   notify_venue_change / notify_league_change reason whitelists
--   extended with 'team_expelled' and 'fixtures_cascaded' so the
--   withdraw/expel RPCs (migs 102/103) can broadcast both the
--   team-level state change and the bulk fixture cascade.
--
-- Additive only. No CHECK changes (status enum already allows
-- 'expelled' from mig 088). Existing rows untouched.

ALTER TABLE public.competition_teams
  ADD COLUMN IF NOT EXISTS expulsion_reason text;

-- Extend notify_venue_change whitelist
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
    'fixtures_cascaded',
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
    'team_expelled',
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
    false
  );
END;
$function$;

-- Extend notify_league_change whitelist
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
