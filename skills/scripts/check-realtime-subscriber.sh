#!/bin/bash
# skills/scripts/check-realtime-subscriber.sh — Hard Rule 10 automation.
#
# A server-side realtime publisher MUST have a matching client subscriber.
# When a migration calls realtime.send(payload, TYPE, TOPIC, PRIVATE) with a
# NEW topic/event, App.jsx needs a supabase.channel(TOPIC).on(TYPE, {event})
# subscriber whose topic, event name, and private flag match — otherwise the
# broadcast is published into the void (or blocked by default-deny RLS on a
# mismatched private flag, the mig-062 incident).
#
# notify_team_change() is the shared helper: it already publishes on
# 'team_live:<key>' as a 'broadcast' and App.jsx has the matching generic
# subscriber (channel('team_live:*').on('broadcast', {event:'broadcast'})).
# So a bare `PERFORM notify_team_change(...)` is COVERED and not flagged.
# What this check flags is a DIRECT realtime.send(...) in a staged migration,
# which introduces (or could introduce) a new topic/event that needs its own
# subscriber confirmed by eye against App.jsx.
#
# HEURISTIC — the topic is built at runtime ('team_live:' || key) so the script
# cannot string-match topics exactly; it surfaces every direct realtime.send
# for a human/agent to confirm the subscriber. ADVISORY in the commit hook
# (loud warning, never blocks); exits non-zero standalone for the proof gate.
#
# Usage:  bash skills/scripts/check-realtime-subscriber.sh [file ...]
# Exit: 0 = clean/nothing to check; 1 = direct realtime.send needs a subscriber check.

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 0; }
cd "$ROOT" || exit 0

APP="apps/inorout/src/App.jsx"

if [ "$#" -gt 0 ]; then
  MIGS=$(printf '%s\n' "$@" | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' | grep -v '_down\.sql$')
else
  MIGS=$( { git diff --cached --name-only --diff-filter=ACM 2>/dev/null; \
            git diff --name-only --diff-filter=ACM 2>/dev/null; } \
          | sort -u \
          | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' \
          | grep -v '_down\.sql$')
fi

[ -z "$MIGS" ] && { echo "check-realtime-subscriber: no staged migration files — nothing to check."; exit 0; }

HITS=""
for MIG in $MIGS; do
  [ -f "$MIG" ] || continue
  # Direct realtime.send calls (ignore the notify_team_change helper's own
  # definition line — but a migration that REDEFINES notify_team_change still
  # gets surfaced, which is correct: the 062 private-flag bug lived there).
  SEND_LINES=$(grep -nE 'realtime\.send[[:space:]]*\(' "$MIG" 2>/dev/null | grep -oE '^[0-9]+')
  for LN in $SEND_LINES; do
    HITS="${HITS}  [${MIG}:${LN}] direct realtime.send(...) — confirm a matching subscriber in ${APP}\n"
  done
done

if [ -n "$HITS" ]; then
  echo "REALTIME-SUBSCRIBER (Hard Rule 10) — server-side publisher(s) to verify:"
  printf "%b" "$HITS"
  echo ""
  echo "For each realtime.send(payload, TYPE, TOPIC, PRIVATE) above, confirm ${APP} has a"
  echo "matching supabase.channel(TOPIC).on(TYPE, { event }) subscriber with the SAME topic,"
  echo "event name, and private flag. Existing generic subscriber (mig 062):"
  grep -nE "supabase\.channel\(\`team_live:|event: 'broadcast'" "$APP" 2>/dev/null | sed 's/^/    /'
  echo "A bare PERFORM notify_team_change(...) is already covered by that subscriber and is NOT"
  echo "flagged here — only direct realtime.send needs its own confirmed subscriber."
  exit 1
fi

echo "check-realtime-subscriber: no direct realtime.send in staged migrations — clean."
exit 0
