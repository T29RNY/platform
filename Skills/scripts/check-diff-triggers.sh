#!/bin/bash
# skills/scripts/check-diff-triggers.sh — mechanical proof-gate classifier.
#
# The dev-loop mandates certain skills conditionally on the agent NOTICING a
# trigger in its diff. That is the weak link: "did the agent spot that this
# touched an RPC?" This script makes the detection MECHANICAL — it reads the
# diff and prints exactly which mandatory skills the proof gate must run, so
# the trigger no longer depends on the agent's attention.
#
# Triggers (see CLAUDE.md Hard Rules + dev-loop SKILL proof gate):
#   migration / RLS touch          → FORCE skills/schema-sync.md
#   RPC CREATE OR REPLACE touch     → FORCE skills/rpc-security-sweep.md
#                                            + skills/ephemeral-verify.md
#   Phase-5+ apps/inorout touch     → FORCE skills/casual-regression.md
#
# Usage:  bash skills/scripts/check-diff-triggers.sh [file ...]
#   No args → git diff --name-only main...HEAD + working + staged.
# Exit: 0 = no forced skills; 1 = one or more skills forced (see output).

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 2; }
cd "$ROOT" || exit 2

if [ "$#" -gt 0 ]; then
  FILES=$(printf '%s\n' "$@")
else
  FILES=$( { git diff --name-only main...HEAD 2>/dev/null; \
             git diff --name-only 2>/dev/null; \
             git diff --name-only --cached 2>/dev/null; } )
fi
FILES=$(printf '%s\n' $FILES | sort -u | sed '/^$/d')

[ -z "$FILES" ] && { echo "RESULT: no forced skills — no changed files detected."; exit 0; }

FORCED=""
force(){ FORCED="${FORCED}  $1 — $2\n"; }

# ── Migration / RLS touch → schema-sync ─────────────────────────────────────
MIGS=$(printf '%s\n' "$FILES" | grep -E '^rls_migrations/.*\.sql$')
if [ -n "$MIGS" ]; then
  force "skills/schema-sync.md" "migration/RLS files touched: $(printf '%s ' $MIGS)"
fi

# ── RPC CREATE OR REPLACE touch → rpc-security-sweep + ephemeral-verify ──────
RPC_MIGS=""
for MIG in $MIGS; do
  [ -f "$MIG" ] || continue
  if grep -qiE 'CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION' "$MIG"; then
    RPC_MIGS="$RPC_MIGS $MIG"
  fi
done
if [ -n "$RPC_MIGS" ]; then
  force "skills/rpc-security-sweep.md" "CREATE OR REPLACE FUNCTION in:$RPC_MIGS"
  force "skills/ephemeral-verify.md" "write-RPC change needs live-DB end-to-end proof in:$RPC_MIGS"
fi

# ── Migration touching the incidents table → safeguarding read-filter guard ──
# Any migration that reads/writes incidents must honour the safeguarding
# exclusion (mig 468). Force the dedicated enforcement check.
INC_MIGS=""
for MIG in $MIGS; do
  [ -f "$MIG" ] || continue
  case "$MIG" in *_down.sql) continue;; esac
  if grep -qiE '(FROM|JOIN|UPDATE|INTO)[[:space:]]+incidents[[:space:]]' "$MIG"; then
    INC_MIGS="$INC_MIGS $MIG"
  fi
done
if [ -n "$INC_MIGS" ]; then
  force "Skills/scripts/check-incident-safeguarding.sh" "incidents-table migration(s):$INC_MIGS — run the safeguarding read-filter guard"
fi

# ── Phase-5+ apps/inorout touch → casual-regression ─────────────────────────
# Any app-source or core change on the live casual path. (Docs/config under
# apps/inorout that don't ship are excluded by requiring src/.)
CASUAL=$(printf '%s\n' "$FILES" | grep -E '^(apps/inorout/src/|packages/core/)')
if [ -n "$CASUAL" ]; then
  force "skills/casual-regression.md" "apps/inorout/src or packages/core touched: $(printf '%s ' $CASUAL | cut -c1-120)"
fi

if [ -n "$FORCED" ]; then
  echo "PROOF-GATE TRIGGERS — the following skills are MANDATORY for this diff:"
  printf "%b" "$FORCED"
  echo ""
  echo "Run each forced skill before the merge gate. These are not optional and not"
  echo "conditional on noticing the trigger — the diff itself forces them."
  exit 1
fi

echo "RESULT: no forced skills — diff touches no migration/RLS/RPC/casual-core surface."
exit 0
