-- ════════════════════════════════════════════════════════════════════════════
-- 129 — link_player_to_user: add notify_team_change broadcast
-- ════════════════════════════════════════════════════════════════════════════
-- HARD RULE 10: server-side writers that mutate `players` must broadcast.
-- link_player_to_user already audits (good) but didn't broadcast — so sibling
-- tabs/devices viewing the same team stayed stale on the server-computed
-- `is_self` value after a link. The specific failure mode:
--
--   User has /p/<token> open in one tab and /admin/<token> open in another
--   (or PWA + browser combo). Player tab signs in → link_player_to_user
--   fires → players.user_id is now set in DB. Admin tab's cached squad
--   payload still has user_id=null for that row → is_self=false →
--   PlayerView's `needsSelfAuth = isAdmin && !me?.isSelf` (PlayerView.jsx:96)
--   stays true → OTP modal keeps popping on admin tab until manual refresh.
--
-- Rare scenario but real, and HARD RULE 10 strict reading. Cost of fix is
-- a single PERFORM call, fires at most once per (player, user) lifetime
-- because App.jsx:560 only calls link_player_to_user when `!player.userId`.
--
-- Reuses existing whitelisted reason 'player_updated' (generic player-row
-- change). search_path tightened from 'public' to 'public, pg_temp' (matches
-- migs 063/124/128).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.link_player_to_user(
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id      text;
  v_existing_user  uuid;
  v_user_id        uuid;
  v_team_id        text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;

  SELECT id, user_id INTO v_player_id, v_existing_user
    FROM players WHERE token = p_token;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  IF v_existing_user IS NOT NULL AND v_existing_user <> v_user_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='user_already_linked';
  END IF;

  UPDATE players SET user_id = v_user_id WHERE id = v_player_id;

  SELECT team_id INTO v_team_id FROM team_players
    WHERE player_id = v_player_id
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_team_id IS NOT NULL THEN
    INSERT INTO audit_events (
      team_id, actor_type, actor_user_id, actor_identifier,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_team_id, 'player', v_user_id,
      'player_token:' || md5(p_token),
      'player_account_linked', 'player', v_player_id,
      jsonb_build_object('linked_user_id', v_user_id)
    );

    -- mig 129: broadcast so sibling tabs re-fetch and is_self flips
    PERFORM notify_team_change(v_team_id, 'player_updated');
  END IF;

  RETURN jsonb_build_object('ok', true, 'player_id', v_player_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$$;
