#!/bin/bash
# scripts/check-build.sh
# Runs the monorepo build and reports pass/fail cleanly.
# Exit code: 0 = pass, 1 = fail
# Usage: bash skills/scripts/check-build.sh

echo "--- BUILD CHECK ---"
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# Gate: workspace dep declarations must be sane before we even try to build.
# Catches the bug class "package.json lists a Vite alias as a real dep,"
# which breaks Vercel's npm install in a clean container even though the
# local build passes (Vite resolves aliases at build time).
bash Skills/scripts/check-workspace-deps.sh
DEP_EXIT=$?
if [ $DEP_EXIT -ne 0 ]; then
  echo ""
  echo "RESULT: FAIL — invalid workspace deps, build not attempted."
  exit 1
fi
echo ""

OUTPUT=$(cd apps/inorout && npm run build 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  WARNINGS=$(echo "$OUTPUT" | grep -i "warning" | wc -l | tr -d ' ')
  if [ "$WARNINGS" -gt "0" ]; then
    echo "RESULT: PASS WITH WARNINGS ($WARNINGS warnings)"
    echo "$OUTPUT" | grep -i "warning"
  else
    echo "RESULT: PASS — clean, zero warnings"
  fi
  exit 0
else
  echo "RESULT: FAIL"
  echo "$OUTPUT" | tail -30
  exit 1
fi
