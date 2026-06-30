#!/bin/bash
# skills/scripts/qa-suite.sh
# The e2e lane for the qa-loop, run the ONLY way that doesn't cry wolf on this repo.
#
# Two traps this script exists to avoid (see e2e/playwright.config.mjs header):
#   1. TOKEN ROTATION — a bare `npm run e2e` chains the signed-in projects and rotates
#      the single-use demo refresh token past its grace window → FALSE "signed out"
#      reds. Fix: run each project COLD and ALONE. This script loops one playwright
#      process per project, so every project gets a fresh mint = cold.
#   2. FLAKE (retries:0) — a genuine flake shows as a hard fail. Fix: any red is
#      re-run ONCE cold; pass-on-retry is reported as FLAKE, not FAIL.
#
# It also refuses to lie: the apps are NOT auto-started and point at localhost. If a
# project's dev server isn't listening, it is reported SKIP (server down) — never a
# silent green.
#
# Usage:  bash skills/scripts/qa-suite.sh [project ...]
#   no args  → all projects
#   args     → only those projects (e.g. inorout-alex inorout-sam tokens)
#
# Exit: 0 = no FAIL (PASS/FLAKE/SKIP only), 1 = at least one FAIL, 2 = usage/setup error.

set -o pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 2; }
cd "$ROOT"
CONFIG="e2e/playwright.config.mjs"
[ -f "$CONFIG" ] || { echo "missing $CONFIG"; exit 2; }

ALL="inorout-alex inorout-sam tokens venue-alex venue-sam hq-alex superadmin-alex display-token ref-token"
PROJECTS="${*:-$ALL}"

# project -> localhost port it talks to (from e2e/lib/auth.mjs ORIGINS).
port_for() {
  case "$1" in
    inorout-alex|inorout-sam|tokens) echo 5173 ;;
    superadmin-alex)                 echo 5175 ;;
    venue-alex|venue-sam)            echo 5176 ;;
    hq-alex)                         echo 5177 ;;
    ref-token)                       echo 5180 ;;
    display-token)                   echo 5181 ;;
    *)                               echo "" ;;
  esac
}

# dependency-free TCP probe (no nc/curl needed)
port_up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3>&- ; }

run_project() {
  npx playwright test --config "$CONFIG" --project="$1"
}

declare -a SUMMARY
fail=0
for p in $PROJECTS; do
  port=$(port_for "$p")
  if [ -z "$port" ]; then
    SUMMARY+=("SKIP  $p  (unknown project)"); continue
  fi
  if ! port_up "$port"; then
    SUMMARY+=("SKIP  $p  (dev server not listening on :$port — start it first)")
    continue
  fi

  echo ""
  echo "=== qa-suite: $p (cold run) ============================================"
  run_project "$p"; rc=$?
  if [ "$rc" -eq 0 ]; then
    SUMMARY+=("PASS  $p"); continue
  fi

  echo ""
  echo "=== qa-suite: $p RED — re-running ONCE cold to rule out a flake ========="
  run_project "$p"; rc2=$?
  if [ "$rc2" -eq 0 ]; then
    SUMMARY+=("FLAKE $p  (failed then passed — quarantine, do not 'fix')")
  else
    SUMMARY+=("FAIL  $p  (red on two cold runs — real)"); fail=1
  fi
done

echo ""
echo "================= qa-suite summary ================="
for line in "${SUMMARY[@]}"; do echo "  $line"; done
echo "==================================================="
[ "$fail" -eq 0 ] && echo "RESULT: no real failures" || echo "RESULT: real failures present"
exit "$fail"
