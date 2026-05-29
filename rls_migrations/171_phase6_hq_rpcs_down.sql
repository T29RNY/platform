-- 171_phase6_hq_rpcs_down.sql — revert mig 171.

DROP FUNCTION IF EXISTS public.hq_resolve_incident(text, uuid, text);
DROP FUNCTION IF EXISTS public.hq_get_venue_detail(text, text);
DROP FUNCTION IF EXISTS public.hq_get_company_state(text);
DROP FUNCTION IF EXISTS public.company_admin_whoami();
DROP FUNCTION IF EXISTS public.resolve_company_caller(text);

-- Restore notify_venue_change to the mig-127 body (drop 'incident_resolved').
CREATE OR REPLACE FUNCTION public.notify_venue_change(p_venue_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
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
    'result_corrected'
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
REVOKE ALL     ON FUNCTION public.notify_venue_change(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_venue_change(text, text) FROM anon, authenticated;

-- Revert audit_events.actor_type CHECK (drop 'company_admin').
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_actor_type_check
  CHECK (actor_type = ANY (ARRAY[
    'team_admin','vice_captain','club_admin','super_admin','player','service_role',
    'system','venue_admin','league_admin','platform_admin','referee'
  ]));
