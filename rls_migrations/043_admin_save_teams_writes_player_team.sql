-- Migration 043 — admin_save_teams ALSO writes players.team
--
-- WHY: PlayerView's Live Board (apps/inorout/src/views/PlayerView.jsx:203)
-- reads p.team to render the per-player confirmed-team tile. admin_save_teams
-- previously only wrote matches.team_a/team_b (the persistent match row),
-- leaving p.team stale. After confirming teams in TeamsScreen, the
-- player-facing team sheet was empty.
--
-- Fix: when p_confirm=true, clear p.team for every player on the team,
-- then set 'A'/'B' for the confirmed lineup ids. Scoped to v_team_id via
-- team_players join so we never touch other teams' players.

CREATE OR REPLACE FUNCTION admin_save_teams(
  p_admin_token          text,
  p_match_id             text,
  p_team_a               text[],
  p_team_b               text[],
  p_confirm              boolean DEFAULT false,
  p_predicted_winner     text    DEFAULT NULL,
  p_predicted_confidence numeric DEFAULT NULL,
  p_balance_score        numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id     text;
  v_schedule_id text;
  v_match_id    text;
  v_reason      text;
BEGIN
  SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT id INTO v_schedule_id
  FROM schedule
  WHERE team_id = v_team_id AND active = true
  LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_schedule';
  END IF;

  IF p_match_id IS NOT NULL AND p_match_id <> '' THEN
    IF NOT EXISTS (
      SELECT 1 FROM matches WHERE id = p_match_id AND team_id = v_team_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='match_not_found';
    END IF;
    v_match_id := p_match_id;
  ELSE
    SELECT active_match_id INTO v_match_id FROM schedule WHERE id = v_schedule_id;
    IF v_match_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_active_match';
    END IF;
  END IF;

  IF p_confirm THEN
    UPDATE matches SET
      team_a               = to_jsonb(p_team_a),
      team_b               = to_jsonb(p_team_b),
      teams_draft          = null,
      predicted_winner     = p_predicted_winner,
      predicted_confidence = p_predicted_confidence,
      balance_score        = p_balance_score
    WHERE id = v_match_id AND team_id = v_team_id;

    -- Denormalised players.team for fast Live Board reads
    UPDATE players SET team = NULL
    WHERE id IN (
      SELECT player_id FROM team_players WHERE team_id = v_team_id
    );
    IF array_length(p_team_a, 1) > 0 THEN
      UPDATE players SET team = 'A' WHERE id = ANY(p_team_a);
    END IF;
    IF array_length(p_team_b, 1) > 0 THEN
      UPDATE players SET team = 'B' WHERE id = ANY(p_team_b);
    END IF;

    v_reason := 'match_teams_saved';
  ELSE
    UPDATE matches SET
      teams_draft = jsonb_build_object(
        'a', to_jsonb(p_team_a),
        'b', to_jsonb(p_team_b)
      )
    WHERE id = v_match_id AND team_id = v_team_id;
    v_reason := 'match_teams_saved';
  END IF;

  PERFORM notify_team_change(v_team_id, v_reason);

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, 'team_admin', auth.uid(),
    'admin_token:' || md5(p_admin_token),
    v_reason, 'match', v_match_id,
    jsonb_build_object(
      'confirmed',          p_confirm,
      'team_a_count',       array_length(p_team_a, 1),
      'team_b_count',       array_length(p_team_b, 1),
      'predicted_winner',   p_predicted_winner,
      'balance_score',      p_balance_score
    )
  );

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id, 'confirmed', p_confirm);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='admin_save_teams_failed: ' || SQLERRM;
END;
$$;
