-- =============================================================================
-- Migration 017: Broadcast helper refinement
-- =============================================================================
-- Replaces notify_team_change established in migration 011.
-- Same 2-param signature (p_team_id text, p_reason text) — all callers in
-- migrations 010-016 are unaffected.
--
-- Change: adds RAISE WARNING for unknown reason values (non-blocking —
-- the broadcast still fires; the warning surfaces in Supabase logs only).
--
-- All currently-known reason strings are enumerated here. Add new reasons
-- to v_known_reasons before use. Unknown reasons are never hard-errored
-- so that future callers don't silently break if this list drifts.
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_team_change(
  p_team_id text,
  p_reason  text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
    -- §11.2 locked list (Phase A)
    'player_status_updated',
    'player_paid_updated',
    'player_injured_updated',
    'guest_player_added',
    'guest_payment_updated',
    'match_result_saved',
    'match_cancelled',
    'match_teams_saved',
    'match_bibs_saved',
    'schedule_updated',
    'player_added',
    'player_disabled',
    'player_deleted',
    'player_vc_toggled',
    'payment_confirmed',
    'payment_reset',
    'debt_cleared',
    'debt_waived',
    'potm_vote_cast',
    -- Phase B additions (OI-45, OI-51, OI-62, OI-63)
    'player_enabled',
    'settings_updated',
    'potm_voting_opened',
    'potm_result_announced',
    -- Additional Phase B reasons used across migrations 011-016
    'player_note_updated',
    'player_updated',
    'player_priority_updated',
    'player_name_updated',
    'teams_confirmed',
    'teams_draft_saved',
    'game_live_toggled',
    'game_cancelled'
  ];
BEGIN
  -- Non-blocking reason validation: emit WARNING, still broadcast
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_team_change: unknown reason "%" for team "%"', p_reason, p_team_id;
  END IF;

  -- Resolve live_channel_key
  SELECT live_channel_key INTO v_channel_key
  FROM teams
  WHERE id = p_team_id;

  -- Silently return if team not found or channel key not yet backfilled
  IF v_channel_key IS NULL THEN
    RETURN;
  END IF;

  -- Broadcast via Supabase realtime
  PERFORM realtime.send(
    jsonb_build_object(
      'type',   'team_state_changed',
      'reason', p_reason,
      'at',     extract(epoch from now())
    ),
    'broadcast',
    'team_live:' || v_channel_key
  );
END;
$$;

-- Internal helper only — no external callers permitted
REVOKE ALL ON FUNCTION notify_team_change(text, text) FROM PUBLIC;
