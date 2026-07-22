#!/bin/bash
# skills/scripts/check-telemetry-contract.sh
#
# The event contract IS an API. Once dashboards, funnels and AI briefings read
# an event by name, renaming or dropping it silently breaks every saved insight
# with no build error and no test failure. This gate makes the contract
# mechanical, exactly as check-rpc-consumers.sh does for RPCs:
#
#   1. Every event NAME passed to track() in the codebase MUST be registered in
#      TELEMETRY.md (or an insight silently reads an event nobody documented).
#   2. Every event listed as `live` in TELEMETRY.md MUST have >=1 call site
#      (or the doc claims an event that no longer fires — drift the other way).
#   3. Every track() first argument MUST be a string literal — a variable event
#      name is unauditable and defeats the whole check. Fail on any non-literal.
#
# Because track() is the sole emitter (enforced by check-hygiene CHECK 9) and
# the event set is closed, a whole-repo scan is sound and this can BLOCK, not
# merely advise.
#
# Usage: bash skills/scripts/check-telemetry-contract.sh
# Exit:  0 = contract holds; 1 = drift (prints exactly what).

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 2; }
cd "$ROOT" || exit 2

DOC="$ROOT/TELEMETRY.md"
SCAN="$ROOT/apps $ROOT/packages"
# Never scan build output or dependencies — they contain minified bundles and
# third-party track() methods (e.g. supabase realtime presence.track) that are
# not our analytics events.
EXCLUDES="--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.vite --exclude-dir=build --exclude-dir=ios"
FAILS=0

echo "--- TELEMETRY CONTRACT CHECK ---"

if [ ! -f "$DOC" ]; then
  echo "  ✗ TELEMETRY.md not found at repo root"
  exit 1
fi

# --- collect call sites: first argument of every track( ... ) ---
# Match track("name" or track('name'. Exclude the definition/config in the
# telemetry module itself and this comment style.
RAW=$(grep -rHn "[^a-zA-Z_.]track(" $SCAN \
        --include="*.js" --include="*.jsx" $EXCLUDES 2>/dev/null \
      | grep -v "packages/core/telemetry/analytics.js" \
      | grep -vE "(function|async) track\(" \
      || true)

# 3 — non-literal event names are banned (unauditable).
NONLIT=$(printf '%s\n' "$RAW" | grep -E "track\(\s*[^\"')]" | grep -vE "track\(\s*[\"']" || true)
if [ -n "$NONLIT" ]; then
  echo "  ✗ non-literal event name(s) passed to track() — event names must be string literals:"
  printf '%s\n' "$NONLIT" | sed 's/^/      /'
  FAILS=$((FAILS + 1))
fi

# extract the literal names actually used
USED=$(printf '%s\n' "$RAW" \
        | grep -oE "track\(\s*[\"'][a-z0-9_]+[\"']" \
        | grep -oE "[\"'][a-z0-9_]+[\"']" \
        | tr -d "\"'" \
        | sort -u \
        | sed '/^$/d')

# --- collect documented events: rows in TELEMETRY.md's event table ---
# An event row is a markdown table row whose first cell is `event_name` in
# backticks. Status is read from a `live` / `deprecated` cell.
DOCUMENTED=$(grep -oE "^\|\s*\`[a-z0-9_]+\`" "$DOC" \
              | grep -oE "[a-z0-9_]+" \
              | sort -u \
              | sed '/^$/d')

# events documented AND marked live (for the reverse check)
LIVE_DOCUMENTED=$(grep -E "^\|\s*\`[a-z0-9_]+\`" "$DOC" \
                   | grep -iw "live" \
                   | grep -oE "\`[a-z0-9_]+\`" \
                   | head -n 10000 \
                   | tr -d '`' \
                   | sort -u \
                   | sed '/^$/d')

# 1 — every used event must be documented
for e in $USED; do
  if ! printf '%s\n' "$DOCUMENTED" | grep -qx "$e"; then
    echo "  ✗ event '$e' is emitted by track() but NOT in TELEMETRY.md"
    FAILS=$((FAILS + 1))
  fi
done

# 2 — every live-documented event must have a call site
for e in $LIVE_DOCUMENTED; do
  if ! printf '%s\n' "$USED" | grep -qx "$e"; then
    echo "  ✗ event '$e' is marked live in TELEMETRY.md but has NO track() call site"
    FAILS=$((FAILS + 1))
  fi
done

if [ "$FAILS" -eq 0 ]; then
  N=$(printf '%s\n' "$USED" | sed '/^$/d' | wc -l | tr -d ' ')
  echo "  ✓ $N emitted event(s), all registered and all live-registered events in use"
  echo "check-telemetry-contract: PASS"
  exit 0
fi
echo "check-telemetry-contract: FAIL — $FAILS issue(s)"
exit 1
