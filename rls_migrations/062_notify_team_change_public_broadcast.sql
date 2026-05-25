-- ════════════════════════════════════════════════════════════════════════════
-- 062 — notify_team_change broadcasts public, not private
-- ════════════════════════════════════════════════════════════════════════════
-- realtime.send defaults to private=true. Combined with the default-deny
-- RLS state on realtime.messages, no client could ever subscribe to the
-- broadcasts the server was publishing. The team_live:* topics were a
-- write-only firehose with nobody listening.
--
-- Verified pre-062:
--   SELECT topic, private FROM realtime.messages WHERE topic LIKE 'team_live:%';
--   → every row had private = true
--
-- Verified post-062:
--   SELECT notify_team_change('<team_id>', 'settings_updated');
--   SELECT private FROM realtime.messages WHERE topic = 'team_live:<key>'
--     ORDER BY inserted_at DESC LIMIT 1;
--   → false
--
-- This migration adds the 4th argument `false` to realtime.send, making
-- broadcasts public. The channel name `team_live:<live_channel_key>` is
-- already gated by knowledge of the UUID, which is only delivered via the
-- team-state RPCs (gated by valid admin or player tokens). Security model
-- is "secret-by-URL" — same trust as elsewhere in this codebase. Compare:
-- /p/<player_token> grants full player-self power with token alone.
--
-- Nothing else in notify_team_change changes — the v_known_reasons array,
-- the channel-key lookup, and the early returns are byte-for-byte identical
-- to pre-062.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_team_change(p_team_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_channel_key  text;
  v_known_reasons text[] := ARRAY[
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
    'player_account_deleted',
    'player_vc_toggled',
    'payment_confirmed',
    'payment_reset',
    'debt_cleared',
    'debt_waived',
    'potm_vote_cast',
    'player_enabled',
    'settings_updated',
    'potm_voting_opened',
    'potm_result_announced',
    'player_note_updated',
    'player_updated',
    'player_priority_updated',
    'player_name_updated',
    'teams_confirmed',
    'teams_draft_saved',
    'game_live_toggled',
    'game_cancelled',
    'match_teams_confirmed',
    'guest_player_removed'
  ];
BEGIN
  IF NOT (p_reason = ANY(v_known_reasons)) THEN
    RAISE WARNING 'notify_team_change: unknown reason "%" for team "%"',
      p_reason, p_team_id;
  END IF;

  SELECT live_channel_key INTO v_channel_key
  FROM teams WHERE id = p_team_id;

  IF v_channel_key IS NULL THEN RETURN; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type',   'team_state_changed',
      'reason', p_reason,
      'at',     extract(epoch from now())
    ),
    'broadcast',
    'team_live:' || v_channel_key,
    false  -- 062: public broadcast so clients subscribe via channel-key UUID
  );
END;
$function$;
