#!/bin/bash
# skills/scripts/check-drift.sh
# Migration/source drift check (Hard Rule 11 — migration source files MUST land
# in the same commit as the live DB apply; live DB and source code must never drift).
#
# This is a hybrid check: it deterministically enumerates every local numbered
# migration file, then prints a Supabase MCP action block for Claude Code to run.
# Claude Code executes list_migrations via MCP and cross-references the result
# against the printed local list — it does not interpret manually, same pattern
# as check-db-schema.sh.
#
# Usage: bash skills/scripts/check-drift.sh
# Exit code: 0 always (pass/fail evaluated by Claude Code from the MCP result)

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT" || exit 1

echo "--- MIGRATION/SOURCE DRIFT CHECK (Hard Rule 11) ---"
echo ""
echo "[1] Local numbered migration files on the current branch (rls_migrations/, excluding _down):"
echo ""
ls rls_migrations/*.sql 2>/dev/null \
  | grep -v '_down\.sql$' \
  | xargs -n1 basename \
  | sed 's/\.sql$//' \
  | sort
echo ""
echo "[2] SUPABASE MCP ACTION — run this:"
echo "----------------------------------------"
echo "list_migrations (no arguments)"
echo "----------------------------------------"
echo ""
echo "[3] Cross-reference:"
echo "  For every migration returned by list_migrations whose 'name' matches a"
echo "  numbered convention (e.g. ^[0-9]{3}[a-z]?_...), confirm a matching file"
echo "  rls_migrations/<name>.sql exists in the list printed in [1] above."
echo ""
echo "PASS criteria: every live-applied numbered migration has a matching local file."
echo "FAIL if: a live migration's name has no matching local file on this branch —"
echo "  that means the DB is ahead of source (Hard Rule 11 violation). Report the"
echo "  exact migration version + name, and note whether it's a WIP PR not yet"
echo "  merged (check open PRs / recent commits) before treating it as an incident."
echo "  Free-text/unnumbered migration names (auto-generated fixes, hotfixes without"
echo "  a numeric prefix) are common and NOT drift by themselves — only flag a"
echo "  numbered-convention name with no local match."
echo ""

exit 0
