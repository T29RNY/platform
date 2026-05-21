#!/bin/bash
# scripts/check-references.sh
# Checks for references to a term across apps/ and packages/.
# Three modes depending on flag:
#
#   Default (no flag):
#     Finds every occurrence of TERM. Reports file + line.
#     Used to locate all usages before a change.
#
#   --removed:
#     Finds every occurrence. PASS = zero results.
#     Used after deleting a function/variable to confirm it is fully gone.
#
#   --rpc:
#     Finds supabase.rpc("TERM" calls only.
#     PASS = exactly one result, in supabase.js.
#     Used after adding/modifying an RPC to confirm naming convention holds.
#
# Usage:
#   bash skills/scripts/check-references.sh "termToFind"
#   bash skills/scripts/check-references.sh "termToFind" --removed
#   bash skills/scripts/check-references.sh "rpc_name" --rpc
#
# Exit code: 0 = PASS or informational, 1 = FAIL

if [ $# -eq 0 ]; then
  echo "Usage: check-references.sh \"term\" [--removed|--rpc]"
  exit 1
fi

TERM="$1"
FLAG="${2:-}"
ROOT=$(git rev-parse --show-toplevel)
SCAN_PATH="$ROOT/apps $ROOT/packages"

echo "--- REFERENCE CHECK ---"
echo "Term: $TERM"
echo "Mode: ${FLAG:-default (informational)}"
echo ""

case "$FLAG" in

  --removed)
    # Every hit is a failure — the term must be completely gone.
    RESULT=$(grep -rn "$TERM" $SCAN_PATH 2>/dev/null || true)
    if [ -z "$RESULT" ]; then
      echo "RESULT: PASS — \"$TERM\" not found anywhere in apps/ or packages/"
      exit 0
    else
      COUNT=$(echo "$RESULT" | wc -l | tr -d ' ')
      echo "RESULT: FAIL — \"$TERM\" still found ($COUNT occurrence(s)):"
      echo "$RESULT" | sed 's/^/  /'
      echo ""
      echo "Fix: remove or rename every occurrence above before proceeding."
      exit 1
    fi
    ;;

  --rpc)
    # Must appear as supabase.rpc("TERM" exactly once, in supabase.js only.
    # Any occurrence outside supabase.js is a naming convention violation.
    # More than one occurrence means a stale call was not removed.
    RESULT=$(grep -rn "supabase\.rpc(\"$TERM\"" $SCAN_PATH 2>/dev/null || true)

    if [ -z "$RESULT" ]; then
      echo "RESULT: FAIL — supabase.rpc(\"$TERM\") not found anywhere."
      echo "  Expected: exactly one call in packages/core/storage/supabase.js"
      echo "  Likely cause: wrapper not yet written, or RPC name misspelled."
      exit 1
    fi

    COUNT=$(echo "$RESULT" | wc -l | tr -d ' ')
    OUTSIDE=$(echo "$RESULT" | grep -v "supabase\.js" || true)

    if [ -n "$OUTSIDE" ]; then
      echo "RESULT: FAIL — supabase.rpc(\"$TERM\") found outside supabase.js:"
      echo "$OUTSIDE" | sed 's/^/  /'
      echo ""
      echo "Fix: raw RPC name must only appear inside supabase.js."
      exit 1
    fi

    if [ "$COUNT" -gt 1 ]; then
      echo "RESULT: FAIL — supabase.rpc(\"$TERM\") found $COUNT times in supabase.js:"
      echo "$RESULT" | sed 's/^/  /'
      echo ""
      echo "Fix: remove the duplicate call — one wrapper per RPC."
      exit 1
    fi

    echo "RESULT: PASS — supabase.rpc(\"$TERM\") found exactly once in supabase.js:"
    echo "$RESULT" | sed 's/^/  /'
    exit 0
    ;;

  "")
    # Informational — find everything, report it. Always exits 0.
    # Use this before a change to understand scope.
    RESULT=$(grep -rn "$TERM" $SCAN_PATH 2>/dev/null || true)
    if [ -z "$RESULT" ]; then
      echo "RESULT: not found in apps/ or packages/"
    else
      COUNT=$(echo "$RESULT" | wc -l | tr -d ' ')
      echo "Found $COUNT occurrence(s):"
      echo "$RESULT" | sed 's/^/  /'
    fi
    exit 0
    ;;

  *)
    echo "Unknown flag: $FLAG"
    echo "Valid flags: --removed, --rpc"
    exit 1
    ;;

esac
