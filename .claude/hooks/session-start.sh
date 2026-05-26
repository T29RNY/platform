#!/bin/bash
# SessionStart hook — primes the session with current repo state
# so Claude doesn't have to be reminded to read CONTEXT.md / BUGS.md.
# stdout is appended to the assistant's context.

ROOT="/Users/tarny/platform"
cd "$ROOT" 2>/dev/null || exit 0

echo "=== platform session primer ==="
echo ""
echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo ""
echo "Working tree:"
STATUS=$(git status --short 2>/dev/null)
if [ -z "$STATUS" ]; then
  echo "  (clean)"
else
  echo "$STATUS" | sed 's/^/  /'
fi
echo ""
echo "Recent commits:"
git log --oneline -5 2>/dev/null | sed 's/^/  /'
echo ""
echo "BUGS.md — active bugs (first 40 lines):"
head -40 BUGS.md 2>/dev/null | sed 's/^/  /'
echo ""
echo "Reminder: AUDIT → EXECUTE → VERIFY → COMMIT. Deterministic"
echo "checks live in skills/scripts/ — call them, don't reinvent."
echo ""
echo "Skills (read the matching file at the start of each step):"
echo "  skills/cycle.md            — full cycle conductor"
echo "  skills/audit.md            — step 1: scope, no edits"
echo "  skills/execute.md          — step 2: agreed changes only"
echo "  skills/verify.md           — step 3: prove correctness"
echo "  skills/commit.md           — step 4: lock into git"
echo "  skills/post-deploy.md      — step 5: confirm live"
echo "  skills/feature-plan.md     — pre-audit for new features"
echo "  skills/schema-sync.md      — MANDATORY before column rename/drop"
echo "  skills/rpc-security-sweep.md — MANDATORY before any RPC commit"
echo "  skills/post-incident.md    — after every bug fix"
echo ""
echo "Deterministic scripts (skills/scripts/):"
echo "  check-build.sh             — build gate (auto on commit)"
echo "  check-hygiene.sh <file>    — 7 hygiene rules (auto on edit)"
echo "  check-rpc-security.sh <rpc> — SECDEF + search_path + overloads + grants"
echo "  check-rpc-columns.sh <rpc>  — stale column refs in RPC body"
echo "  check-schema-column.sh <table> <col> — impact map before column change"
echo "  check-db-schema.sh <table>  — current schema of a table"
echo "  check-references.sh <term> [--removed|--rpc] — repo-wide grep"
echo "  check-workspace-deps.sh    — @platform/* deps resolve"
