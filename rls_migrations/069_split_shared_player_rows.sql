-- ════════════════════════════════════════════════════════════════════════════
-- 069 — one-shot data migration: split any players row carrying >1 team
-- ════════════════════════════════════════════════════════════════════════════
-- Backfills the model 065/066 just installed: every (team_id, player_id)
-- pair must reference a players row that belongs to exactly that team.
--
-- Algorithm:
--   For each players.id that appears in >1 team_players row, keep the
--   EARLIEST team_players membership pointing at the original players row
--   (this is the team_id its token resolved to before today, so existing
--   PWA installs and bookmarks keep working). For every subsequent
--   team_players row, mint a NEW players row (new id + new token) carrying
--   user_id/name/nickname from the original, then UPDATE the team_players
--   row to reference the new players.id.
--
-- Idempotent: the outer cursor only finds duplicated rows, and after each
-- UPDATE the source row no longer qualifies. Re-running is a no-op.
--
-- Current scope (verified against prod at 2026-05-25):
--   p_fGZIqrMij1w (gbains2010) — 2 team_players rows
--     Finbars Tuesdays  team_L8IgrPslNJ8  2026-05-24 18:06  ← kept
--     Footy Tuesdays    team_KPaoX8oJYMQ  2026-05-25 07:41  ← gets new row
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_player record;
  v_membership record;
  v_new_id text;
  v_new_token text;
  v_keep_team_id text;
BEGIN
  -- Find every players row with more than one team_players membership.
  FOR v_player IN
    SELECT p.id, p.user_id, p.name, p.nickname
      FROM players p
      JOIN team_players tp ON tp.player_id = p.id
     GROUP BY p.id, p.user_id, p.name, p.nickname
    HAVING COUNT(tp.team_id) > 1
  LOOP
    -- Identify the earliest team_players row — we keep that pointer.
    SELECT team_id INTO v_keep_team_id
      FROM team_players
     WHERE player_id = v_player.id
     ORDER BY created_at ASC
     LIMIT 1;

    -- Walk the rest (post-earliest) and re-home each onto a fresh player row.
    FOR v_membership IN
      SELECT team_id, created_at
        FROM team_players
       WHERE player_id = v_player.id
         AND team_id  <> v_keep_team_id
       ORDER BY created_at ASC
    LOOP
      v_new_id    := 'p_' || substr(md5(random()::text), 1, 8);
      v_new_token := generate_url_safe_token('p_', 14);

      INSERT INTO players (
        id, name, nickname, token, user_id, type, status,
        disabled, priority, paid, self_paid,
        goals, motm, attended, total,
        bib_count, w, l, d,
        pay_count, late_dropouts, is_guest
      ) VALUES (
        v_new_id, v_player.name, v_player.nickname, v_new_token,
        v_player.user_id, 'regular', 'none',
        false, false, false, false,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, false
      );

      UPDATE team_players
         SET player_id = v_new_id
       WHERE team_id   = v_membership.team_id
         AND player_id = v_player.id;

      INSERT INTO audit_events (
        team_id, actor_type, actor_user_id, actor_identifier,
        action, entity_type, entity_id, metadata
      ) VALUES (
        v_membership.team_id, 'system', v_player.user_id,
        'migration_069_split',
        'player_row_split', 'player', v_new_id,
        jsonb_build_object(
          'origin_player_id', v_player.id,
          'new_player_id',    v_new_id,
          'team_id',          v_membership.team_id
        )
      );
    END LOOP;
  END LOOP;
END $$;
