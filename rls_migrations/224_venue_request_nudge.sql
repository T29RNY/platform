-- Migration 224 — venue_request_nudge (Phase B Nudge, server-side send, no exposure).
-- The venue triggers a nudge to one of its team bookers; this RPC ONLY records
-- the request as a `venue_nudge_requested` audit_event. The cron's onboarding
-- email job (apps/inorout/api/cron.js) picks it up, resolves the team's admin
-- emails server-side (teamAdminEmails → team_admins/auth.users + teams.admin_email)
-- and sends via the existing mailer. The venue UI never receives a contact —
-- the RPC returns only a recipient COUNT. Walk-in bookers (no team) have no
-- contact and return {ok:false, reason:'no_contact'}.
-- Fire-and-forget write → audit_events row (CLAUDE.md hard-rule #9). Venue-token authed.

CREATE OR REPLACE FUNCTION public.venue_request_nudge(
  p_venue_token text,
  p_booker_key  text,
  p_template    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_team_id text;
  v_venue_name text;
  v_admin_count int := 0;
  v_has_email boolean := false;
  v_recipients int;
  v_nudge_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;

  -- Only registered teams have a reachable contact; walk-ins do not.
  IF p_booker_key IS NULL OR left(p_booker_key, 5) <> 'team:' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_contact');
  END IF;
  v_team_id := substr(p_booker_key, 6);

  -- Authorize: the team must actually be a booker at THIS venue.
  IF NOT EXISTS (
    SELECT 1 FROM pitch_bookings
     WHERE venue_id = v_caller.venue_id AND team_id = v_team_id
       AND status NOT IN ('superseded','declined','expired','hold')
  ) THEN
    RAISE EXCEPTION 'not_a_customer' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_admin_count FROM team_admins WHERE team_id = v_team_id AND revoked_at IS NULL;
  SELECT (admin_email IS NOT NULL) INTO v_has_email FROM teams WHERE id = v_team_id;
  v_recipients := v_admin_count + CASE WHEN COALESCE(v_has_email, false) THEN 1 ELSE 0 END;
  IF v_recipients = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_contact');
  END IF;

  SELECT name INTO v_venue_name FROM venues WHERE id = v_caller.venue_id;
  v_nudge_id := 'nudge_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_team_id, NULL, v_caller.actor_type, v_caller.actor_ident, 'venue_nudge_requested', 'venue_nudge', v_nudge_id,
    jsonb_build_object('venue_id', v_caller.venue_id, 'venue_name', v_venue_name,
                       'booker_key', p_booker_key, 'team_id', v_team_id,
                       'template', COALESCE(p_template, 'check_in')));

  RETURN jsonb_build_object('ok', true, 'nudge_id', v_nudge_id, 'recipients', v_recipients);
END;
$function$;
REVOKE ALL ON FUNCTION public.venue_request_nudge(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_request_nudge(text, text, text) TO anon, authenticated;
