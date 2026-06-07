-- 213: complete the notify_team_change reason whitelist.
--
-- Session-71 audit (finding B1): 10 reasons are emitted by live RPCs but were
-- missing from notify_team_change's v_known_reasons array, so every go-live,
-- week-reopen, group edit, contact edit, leave-squad, result-correction, fixture-
-- status-change, and ref live-match event logged a `RAISE WARNING` on each call.
-- Harmless today (the broadcast still sends; the client subscriber is reason-
-- agnostic), but it is exactly the latent drift that bit us in migs 121/127 — if
-- anyone later tightens the function to skip non-whitelisted reasons, those high-
-- traffic paths go silently stale. The list below is the authoritative set of all
-- reasons emitted across pg_proc as of this migration.
--
-- Whitelist-only change: the function body is otherwise re-applied byte-for-byte.

CREATE OR REPLACE FUNCTION public.notify_team_change(p_team_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    'player_status_updated','player_paid_updated','player_injured_updated',
    'guest_player_added','guest_payment_updated','match_result_saved',
    'match_cancelled','match_teams_saved','match_bibs_saved','schedule_updated',
    'player_added','player_disabled','player_deleted','player_account_deleted',
    'player_vc_toggled','payment_confirmed','payment_reset','debt_cleared',
    'debt_waived','potm_vote_cast','player_enabled','settings_updated',
    'potm_voting_opened','potm_result_announced','player_note_updated',
    'player_updated','player_priority_updated','player_name_updated',
    'teams_confirmed','teams_draft_saved','game_live_toggled','game_cancelled',
    'match_teams_confirmed','guest_player_removed',
    'booking_requested','booking_confirmed','booking_declined',
    'booking_cancelled','booking_superseded',
    'booking_renewal_held','booking_renewal_expired',
    -- 213: added — emitted by live RPCs but previously un-whitelisted
    'week_opened','week_reopened','groups_cleared','group_assigned',
    'player_contact_updated','player_left_squad','result_corrected',
    'fixture_status_changed','match_event_recorded','match_started'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_team_change: unknown reason "%" for team "%"', p_reason, p_team_id;
  END IF;
  SELECT live_channel_key INTO v_channel_key FROM teams WHERE id = p_team_id;
  IF v_channel_key IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    jsonb_build_object('type','team_state_changed','reason',p_reason,'at',extract(epoch from now())),
    'broadcast', 'team_live:' || v_channel_key, false);
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
