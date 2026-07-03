#!/bin/bash
# skills/scripts/check-faq-content-only.sh
# Narrow auto-merge gate for the /faq-sync skill. A FAQ-maintenance diff is only
# eligible for unattended auto-merge when it touches NOTHING but a FAQ content data
# file (apps/*/src/data/faq*.js) — no route, no component, no build config, no DB.
# This is deliberately tighter than check-live-config.sh's CLEAR verdict: CLEAR just
# means "not a protected surface" (a new screen component would still be CLEAR), but
# a content-only diff is the one class of change the operator has pre-approved for
# zero-touch merge (2026-07-02 — see DECISIONS.md).
#
# Exit: 0 = CONTENT-ONLY (eligible for auto-merge), 1 = NOT content-only (must go
# through the normal dev-loop PR + human-merge path), 2 = usage error.

set -o pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 2; }
cd "$ROOT"

if [ "$#" -gt 0 ]; then
  FILES="$*"
else
  FILES=$(git diff --name-only main...HEAD 2>/dev/null; git diff --name-only 2>/dev/null; git diff --name-only --cached 2>/dev/null)
fi
FILES=$(printf '%s\n' $FILES | sort -u | sed '/^$/d')

[ -z "$FILES" ] && { echo "RESULT: NOT CONTENT-ONLY — no changed files detected."; exit 1; }

bad=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    apps/*/src/data/faq*.js) : ;;  # allowed
    *) bad="${bad}  $f\n" ;;
  esac
done <<< "$FILES"

if [ -n "$bad" ]; then
  echo "RESULT: NOT CONTENT-ONLY — diff touches files outside apps/*/src/data/faq*.js:"
  printf "$bad"
  echo ""
  echo "ACTION: route this through the normal dev-loop PR + human-merge gate."
  exit 1
fi

echo "RESULT: CONTENT-ONLY — every changed file matches apps/*/src/data/faq*.js. Files:"
printf '%s\n' $FILES | sed 's/^/  /'
exit 0
