#!/bin/bash
# skills/scripts/check-audit-events.sh — Hard Rule 9 automation.
#
# Every fire-and-forget player-self write RPC MUST INSERT INTO audit_events on
# the server side, so a silent client-side failure still leaves a server trace.
# The pattern was established in migration 060 (set_player_status,
# set_player_paid) and extended in 063 (set_player_injured, add_guest_player,
# remove_guest_player, register_push_subscription, unregister_push_subscription,
# submit_potm_vote, link_player_to_user).
#
# This check scans staged migrations for CREATE [OR REPLACE] FUNCTION bodies
# whose name matches a player-self write pattern and confirms the body contains
# INSERT INTO audit_events. A match without the insert is flagged.
#
# HEURISTIC — the name-pattern can't perfectly identify "player-self write", so
# it is ADVISORY in the commit hook (loud warning, never blocks) and exits
# non-zero standalone for use as a dev-loop proof gate.
#
# Usage:  bash skills/scripts/check-audit-events.sh [file ...]
#   No args → staged+working migration files.
# Exit: 0 = clean/nothing to check; 1 = a matching RPC lacks audit_events.

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 0; }
cd "$ROOT" || exit 0

# Player-self write RPC name patterns (Hard Rule 9 surface).
PATTERN='^(set_player_|add_guest_|remove_guest_|register_.*subscription|unregister_.*subscription|submit_potm_|submit_.*_vote|link_player_to_user|admin_ack_|set_.*_paid|set_.*_status|set_.*_injured)'

if [ "$#" -gt 0 ]; then
  MIGS=$(printf '%s\n' "$@" | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' | grep -v '_down\.sql$')
else
  MIGS=$( { git diff --cached --name-only --diff-filter=ACM 2>/dev/null; \
            git diff --name-only --diff-filter=ACM 2>/dev/null; } \
          | sort -u \
          | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' \
          | grep -v '_down\.sql$')
fi

[ -z "$MIGS" ] && { echo "check-audit-events: no staged migration files — nothing to check."; exit 0; }

MISSES=""
for MIG in $MIGS; do
  [ -f "$MIG" ] || continue

  # Function names defined in this migration (anchored on CREATE so a
  # mandatory DROP FUNCTION line doesn't feed a dropped name in).
  FN_NAMES=$(grep -oE 'CREATE[^(]*FUNCTION[[:space:]]+[a-z_]+' "$MIG" 2>/dev/null \
               | grep -oE '[a-z_]+$' | sort -u)

  for FN in $FN_NAMES; do
    echo "$FN" | grep -qE "$PATTERN" || continue

    # Extract this function's body: from its CREATE line up to the next
    # CREATE ... FUNCTION or end of file. Confirm INSERT INTO audit_events.
    BODY=$(awk -v fn="$FN" '
      $0 ~ ("CREATE[^(]*FUNCTION[[:space:]]+" fn "([[:space:](]|$)") { grab=1 }
      grab && prev_grab && $0 ~ "CREATE[^(]*FUNCTION[[:space:]]+" && $0 !~ ("FUNCTION[[:space:]]+" fn "([[:space:](]|$)") { exit }
      grab { print; prev_grab=1 }
    ' "$MIG")

    if ! printf '%s' "$BODY" | grep -qiE 'INSERT[[:space:]]+INTO[[:space:]]+audit_events'; then
      MISSES="${MISSES}  [${MIG}] ${FN}() — player-self write RPC with NO 'INSERT INTO audit_events'\n"
    fi
  done
done

if [ -n "$MISSES" ]; then
  echo "AUDIT-EVENTS (Hard Rule 9) — player-self write RPC(s) missing a server-side trace:"
  printf "%b" "$MISSES"
  echo ""
  echo "Every fire-and-forget player-self write RPC must INSERT INTO audit_events so a"
  echo "silent client-side failure still leaves a server trace (pattern: migrations 060, 063)."
  echo "Add the INSERT to each function above. If the RPC is not actually a player-self"
  echo "write (name matched by coincidence), this is a false positive — proceed."
  exit 1
fi

echo "check-audit-events: all matching player-self write RPCs INSERT INTO audit_events — clean."
exit 0
