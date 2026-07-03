#!/bin/bash
# skills/scripts/check-incident-safeguarding.sh — safeguarding read-filter invariant.
#
# THE ENFORCEMENT for Incident Triage Phase 2, PR #3 (mig 468). A flagged
# incident (is_safeguarding_flagged = true) must be INVISIBLE to every ordinary
# ops/HQ read. This script FAILs any migration function body that READS the
# incidents table (FROM incidents / JOIN incidents) without carrying the
# is_safeguarding_flagged exclusion predicate — so a future migration that adds
# a new incident read can't silently re-expose safeguarding rows.
#
# Detection is per-FUNCTION and occurrence-counted, NOT whole-file: a function
# with THREE incident reads must mention is_safeguarding_flagged at least THREE
# times. This catches a PARTIAL patch (e.g. 2 of the 3 reads in
# hq_get_company_state) — the exact class the naive "does the body mention the
# column at all?" check would miss.
#
# Writes (UPDATE incidents / INSERT INTO incidents / DELETE FROM incidents) are
# NOT read sites and are not counted — they are gated separately (mig 467 added
# the flag guard to every Phase-1 write RPC).
#
# ALLOW-LIST: the ONE function permitted to read flagged rows is the Lead-only
# list RPC. It is exempt from the count requirement (it still, in practice,
# references the column via `is_safeguarding_flagged IS TRUE`).
#
# Usage:  bash skills/scripts/check-incident-safeguarding.sh [file.sql ...]
#   No args → the migration .sql files in the current diff
#             (git diff main...HEAD + working + staged), matching the
#             check-diff-triggers.sh convention. Historical migrations are NOT
#             re-scanned — this is a forward guard on the change under review.
# Exit: 0 = clean; 1 = an unfiltered incident read found; 2 = usage/repo error.

set -u
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 2; }
cd "$ROOT" || exit 2

# Functions allowed to read flagged rows (the Lead view). Space-delimited.
ALLOWLIST=" venue_list_safeguarding_incidents "

if [ "$#" -gt 0 ]; then
  FILES=$(printf '%s\n' "$@")
else
  FILES=$( { git diff --name-only main...HEAD 2>/dev/null; \
             git diff --name-only 2>/dev/null; \
             git diff --name-only --cached 2>/dev/null; } \
           | grep -E '^rls_migrations/.*\.sql$' )
  # Down-migrations legitimately restore pre-safeguarding read bodies (they only
  # run in a full 468/467/466 revert) — exempt them from this forward guard when
  # scanning the diff. (Explicit file args are always scanned, for negative tests.)
  FILES=$(printf '%s\n' $FILES | grep -Ev '_down\.sql$')
fi
FILES=$(printf '%s\n' $FILES | sort -u | sed '/^$/d')

if [ -z "$FILES" ]; then
  echo "RESULT: no migration files to scan — safeguarding read-filter check N/A."
  exit 0
fi

VIOLATIONS=$(
  for F in $FILES; do
    [ -f "$F" ] || continue
    awk -v FNAME="$F" -v ALLOW="$ALLOWLIST" '
      function flush(   n) {
        if (fn != "" && reads > 0) {
          if (index(ALLOW, " " fn " ") == 0 && flags < reads) {
            printf "%s :: %s — %d incident read(s) but only %d is_safeguarding_flagged predicate(s)\n", FNAME, fn, reads, flags
          }
        }
        fn=""; reads=0; flags=0
      }
      /CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION/ {
        flush()
        line=$0
        sub(/.*FUNCTION[[:space:]]+/, "", line)
        sub(/^public\./, "", line)
        sub(/[[:space:](].*/, "", line)
        fn=line
        next
      }
      {
        # count incident READ sites (FROM/JOIN incidents), ignoring writes
        tmp=$0
        while (match(tmp, /(FROM|JOIN)[[:space:]]+incidents([[:space:]]|[),;]|$)/)) {
          reads++
          tmp=substr(tmp, RSTART+RLENGTH)
        }
        tmp=$0
        while (match(tmp, /is_safeguarding_flagged/)) {
          flags++
          tmp=substr(tmp, RSTART+RLENGTH)
        }
      }
      END { flush() }
    ' "$F"
  done
)

if [ -n "$VIOLATIONS" ]; then
  echo "SAFEGUARDING READ-FILTER VIOLATION — incident read(s) missing the exclusion predicate:"
  echo ""
  printf '%s\n' "$VIOLATIONS"
  echo ""
  echo "Every FROM incidents / JOIN incidents in an ops/HQ read MUST carry"
  echo "  AND <alias>.is_safeguarding_flagged IS NOT TRUE"
  echo "or the function must be the Lead-only list RPC (allow-listed). A flagged"
  echo "incident that leaks into any non-lead read is a child-protection breach."
  exit 1
fi

echo "RESULT: clean — every incident read in the scanned migration(s) carries the"
echo "is_safeguarding_flagged exclusion (or is the allow-listed Lead-only list RPC)."
exit 0
