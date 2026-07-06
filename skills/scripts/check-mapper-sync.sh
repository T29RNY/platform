#!/bin/bash
# skills/scripts/check-mapper-sync.sh — Hard Rule 12 automation.
#
# When an RPC's return shape gains a field but the JS mapper that turns the
# RPC result into a client object never reads it, the field is silently
# dropped. That is the mig-070 `is_self` incident: `is_self` was added to
# get_team_state_by_admin_token's squad rows but dbToPlayer never picked it
# up, so App.jsx's `squad.find(p => p.is_self)` was always undefined and
# admins rendered AS the first squad member for ~12 days in production.
#
# This check extracts the field names a staged migration's RPC(s) RETURN
# (jsonb_build_object keys + RETURNS TABLE column names) and confirms each
# one is referenced somewhere in packages/core/storage/supabase.js — where
# every mapper lives (dbToPlayer, dbToTeam-class inline shapes in
# getTeamStateBy*, dbToMatch, dbToSchedule, ...). A returned field that
# appears NOWHERE in supabase.js is a candidate silent-drop.
#
# HEURISTIC — it cannot know which jsonb block feeds which mapper, so it
# checks the field name against the whole data-access file (which references
# nearly every consumed column). Expect occasional false positives for
# fields the client intentionally never surfaces (audit-only returns). It is
# therefore ADVISORY in the commit hook (loud warning, never blocks) and
# exits non-zero standalone so the dev-loop proof gate can gate on it.
#
# Usage:  bash skills/scripts/check-mapper-sync.sh [file ...]
#   No args → staged+working migration files (rls_migrations/NNN_*.sql).
# Exit: 0 = clean/nothing to check; 1 = candidate silent-drop field(s) found.

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 0; }
cd "$ROOT" || exit 0

MAPPER_FILE="packages/core/storage/supabase.js"

# ── Collect the migration files to inspect ──────────────────────────────────
if [ "$#" -gt 0 ]; then
  MIGS=$(printf '%s\n' "$@" | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' | grep -v '_down\.sql$')
else
  MIGS=$( { git diff --cached --name-only --diff-filter=ACM 2>/dev/null; \
            git diff --name-only --diff-filter=ACM 2>/dev/null; } \
          | sort -u \
          | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' \
          | grep -v '_down\.sql$')
fi

[ -z "$MIGS" ] && { echo "check-mapper-sync: no staged migration files — nothing to check."; exit 0; }

if [ ! -f "$MAPPER_FILE" ]; then
  echo "check-mapper-sync: $MAPPER_FILE not found — cannot verify mappers."
  exit 0
fi

MISSES=""
for MIG in $MIGS; do
  [ -f "$MIG" ] || continue

  # jsonb_build_object keys are the ODD (1st, 3rd, 5th ...) arguments of each
  # jsonb_build_object(...) call. A naive "'literal'," grep also catches value
  # strings and audit/notify/enum literals, so we parse properly: strip SQL
  # line comments, slurp the file to one line, walk each jsonb_build_object(...)
  # tracking paren depth + single-quote state, split its args at depth-0 commas,
  # and emit only the even-index (key-position) pure snake_case literals.
  KEYS_JSONB=$(sed 's/--.*$//' "$MIG" 2>/dev/null | tr '\n' ' ' | awk '
    {
      s = $0; n = length(s); start = 1;
      # Parse EVERY jsonb_build_object( occurrence independently (start advances
      # only past the "(" of each match, so a NESTED jsonb_build_object inside a
      # value is found and parsed on its own iteration — the is_self bug lived
      # in exactly such a nested jsonb_agg(jsonb_build_object(...)) squad row).
      while ((p = index(substr(s, start), "jsonb_build_object(")) > 0) {
        pos = start + p - 1;
        i = pos + length("jsonb_build_object(");
        start = i;
        depth = 1; inq = 0; arg = ""; argidx = 0;
        while (i <= n && depth > 0) {
          c = substr(s, i, 1);
          if (inq) {
            if (c == "'\''") {
              if (substr(s, i+1, 1) == "'\''") { arg = arg c; i++; }  # '\'''\'' escape
              else { inq = 0; }
            } else { arg = arg c; }
          } else {
            if (c == "'\''") { inq = 1; }
            else if (c == "(") { depth++; arg = arg c; }
            else if (c == ")") { depth--; if (depth > 0) arg = arg c; }
            else if (c == "," && depth == 1) {
              if (argidx % 2 == 0 && arg ~ /^[[:space:]]*[a-z][a-z0-9_]*[[:space:]]*$/) {
                gsub(/[[:space:]]/, "", arg); print arg;
              }
              argidx++; arg = "";
            } else { arg = arg c; }
          }
          i++;
        }
      }
    }' | sort -u)

  # RETURNS TABLE (col type, col type, ...) — grab the column names.
  KEYS_TABLE=$(grep -ioE 'RETURNS[[:space:]]+TABLE[[:space:]]*\([^)]*\)' "$MIG" 2>/dev/null \
                 | grep -oE '[a-z][a-z0-9_]+[[:space:]]+(text|int|integer|bigint|boolean|bool|uuid|numeric|jsonb|json|timestamptz|date|real|double)' \
                 | awk '{print $1}' | sort -u)

  CANDS=$(printf '%s\n%s\n' "$KEYS_JSONB" "$KEYS_TABLE" | sed '/^$/d' | sort -u)
  [ -z "$CANDS" ] && continue

  for FIELD in $CANDS; do
    # A returned field is "mapped" if its snake_case name appears anywhere in
    # the mapper file (as r.field, data.field, ->>'field', b.field, etc.).
    if ! grep -qE "[^a-zA-Z0-9_]${FIELD}([^a-zA-Z0-9_]|$)" "$MAPPER_FILE"; then
      MISSES="${MISSES}  [${MIG}] returns '${FIELD}' — not referenced in ${MAPPER_FILE}\n"
    fi
  done
done

if [ -n "$MISSES" ]; then
  echo "MAPPER-SYNC (Hard Rule 12) — candidate silent-drop field(s):"
  printf "%b" "$MISSES"
  echo ""
  echo "Each field above is RETURNED by a staged RPC but appears in NO mapper in"
  echo "$MAPPER_FILE. If a JS consumer reads it, add it to the matching mapper"
  echo "(dbToPlayer / inline getTeamStateBy* shape / dbToMatch / ...) in the SAME commit."
  echo "If the field is intentionally server-only (audit return, never surfaced to the"
  echo "client), this is a false positive — proceed."
  exit 1
fi

echo "check-mapper-sync: all returned fields are referenced in $MAPPER_FILE — clean."
exit 0
