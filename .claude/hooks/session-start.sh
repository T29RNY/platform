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
