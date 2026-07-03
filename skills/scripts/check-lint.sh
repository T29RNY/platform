#!/bin/bash
# check-lint.sh — deterministic correctness lint gate.
#
# Catches the runtime-error classes that check-build.sh / node --check /
# check-hygiene.sh all pass clean:
#   • no-undef                    — identifier referenced but never declared or
#                                    imported (a ReferenceError at runtime; the
#                                    setClearDebtExpanded casual-status-tap
#                                    outage, PR #251).
#   • react-hooks/rules-of-hooks  — a hook called conditionally / in a loop
#                                    (crashes React at runtime).
#
# Rules + scope live in eslint.config.mjs (repo root). This wrapper only runs
# it and translates the result — same shape as the sibling check-*.sh scripts.
#
# Degrades to a PASS (exit 0) when eslint is not installed yet — a fresh clone
# before `npm install` must not be blocked from committing. Once deps are in,
# the gate is live.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 0

ESLINT="$ROOT/node_modules/.bin/eslint"

echo "--- LINT CHECK (no-undef + rules-of-hooks) ---"

if [ ! -x "$ESLINT" ]; then
  echo "SKIP — eslint not installed (run: npm install). Gate inactive until then."
  exit 0
fi

OUTPUT=$("$ESLINT" . 2>&1)
EXIT=$?

if [ $EXIT -eq 0 ]; then
  echo "PASS — no undefined identifiers, no hook-order violations."
  exit 0
fi

echo "$OUTPUT"
echo ""
echo "RESULT: FAIL — see errors above."
echo "These are runtime crashes the build cannot see. Fix (declare/import the"
echo "missing name, or move the hook to the top level) and re-run."
exit 1
