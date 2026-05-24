-- Migration 049 — notify_team_change: add 'player_account_deleted' to whitelist
--
-- Migration 047 (delete_my_account FK purge, session 37) passes
-- 'player_account_deleted' to notify_team_change. The function has a hard
-- whitelist of reason strings and emits a WARNING for unknown ones — so
-- every account deletion logged a WARNING:
--   notify_team_change: unknown reason "player_account_deleted" for team "<X>"
-- The broadcast still went out correctly (the whitelist only gates the
-- warning, not the realtime.send). This change just stops the log noise
-- by acknowledging that 'player_account_deleted' is a known legitimate
-- reason.
--
-- Surfaced during the Phase 4 cosmetic log cleanup pass after the 73.7%
-- error-rate investigation. The function body otherwise reproduces the
-- previous version verbatim.

CREATE OR REPLACE FUNCTION notify_team_change(p_team_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'realtime', 'pg_temp'
AS $$
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
    'team_live:' || v_channel_key
  );
END;
$$;

-- ============================================================
-- ADJACENT FIX (applied via cron.alter_job, not part of this migration body):
--
-- All 6 pg_cron notification jobs (jobids 1-6) were calling the apex domain
-- 'https://in-or-out.com/api/notify' instead of the canonical
-- 'https://www.in-or-out.com/api/notify'. The apex returns a 307 redirect
-- to www, and pg_net (like all sane HTTP clients) STRIPS the Authorization
-- header when following a cross-host redirect. So the cron's bearer token
-- never reached the function → /api/notify returned 401 → push notifications
-- silently never sent.
--
-- This bug had been latent since the cron jobs were created; it was masked
-- by the earlier 'Vapid public key must be set' 500 crashes (resolved by
-- correctly setting VAPID env vars on Vercel earlier today). Once the 500s
-- stopped, the 401s appeared.
--
-- Fix applied directly to live cron.job table via:
--   SELECT cron.alter_job(<id>, command := <new command body with www>)
-- for jobids 1-6. No migration file change needed because cron.job rows
-- aren't defined in any migration — they were originally set up manually
-- via the SQL editor.
-- ============================================================
