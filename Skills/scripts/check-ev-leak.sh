#!/bin/bash
# check-ev-leak.sh — outputs a ready-to-execute Supabase MCP action block
# that checks all _e2e_* rows were rolled back after an ephemeral verify.
# Usage: bash skills/scripts/check-ev-leak.sh
# Then execute the output via Supabase MCP execute_sql.
# Every column must return 0 — non-zero = rollback failed, STOP and restore.

cat <<'SQL'
ACTION: execute_sql
description: EV leak check — confirm all _e2e_* rows were rolled back
query:
SELECT
  (SELECT count(*)::int FROM venues       WHERE id   LIKE 'v_e2e_%')     AS venues,
  (SELECT count(*)::int FROM leagues      WHERE id   LIKE 'l_e2e_%')     AS leagues,
  (SELECT count(*)::int FROM seasons      WHERE id::text LIKE '%e2e%')   AS seasons,
  (SELECT count(*)::int FROM teams        WHERE id   LIKE '%e2e%')       AS teams,
  (SELECT count(*)::int FROM players      WHERE id   LIKE 'p_e2e_%')     AS players,
  (SELECT count(*)::int FROM player_match WHERE match_id LIKE '%e2e%')   AS player_match_rows,
  (SELECT count(*)::int FROM audit_events
     WHERE created_at > now() - interval '5 minutes'
       AND (metadata->>'home_team_id' LIKE '%e2e%'
         OR metadata->>'away_team_id' LIKE '%e2e%'))                     AS audit_rows;

EXPECTED: every column = 0. Non-zero = rollback failed. STOP and restore before continuing.
SQL
