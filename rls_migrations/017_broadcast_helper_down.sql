-- =============================================================================
-- Migration 017 DOWN: Revert broadcast helper to migration 011 body
-- =============================================================================
-- Restores notify_team_change to its original migration 011 form
-- (no reason validation, no WARNING).
-- DO NOT DROP — all migrations 010-016 call this function.
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
  v_channel_key text;
BEGIN
  SELECT live_channel_key INTO v_channel_key
  FROM teams
  WHERE id = p_team_id;

  IF v_channel_key IS NULL THEN
    RETURN;
  END IF;

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

REVOKE ALL ON FUNCTION notify_team_change(text, text) FROM PUBLIC;
