#!/bin/bash
# PreToolUse hook for Bash. If the command being run is `git commit`:
#   1. Block if any staged rls_migrations/NNN_*.sql lacks a matching
#      _down.sql (catches the mig 079 hotfix-without-source incident).
#   2. Block if the build fails.
#
# Exit codes:
#   0 — not a commit, OR all gates passed
#   2 — a gate failed; commit is blocked

ROOT="/Users/tarny/platform"

PAYLOAD=$(cat)
CMD=$(echo "$PAYLOAD" | jq -r '.tool_input.command // empty')

# Two-part match so flags between `git` and `commit` are allowed
# (e.g. `git -C /path commit -m ...`):
#   1. The command invokes `git` as a word.
#   2. `commit` appears as a standalone subcommand word.
# Word boundary on `commit` rejects `commit-tree`, `commit-graph`, etc.
# Quoted commit messages that contain the literal word "commit"
# don't match because `"commit"` lacks the required leading whitespace.
if ! echo "$CMD" | grep -Eq '(^|[^a-zA-Z0-9_-])git([[:space:]]|$)'; then
  exit 0
fi
if ! echo "$CMD" | grep -Eq '[[:space:]]commit([[:space:]]|$)'; then
  exit 0
fi

cd "$ROOT" || exit 0

# ── Gate 1: every staged forward migration must have a matching _down.sql ──
#
# Catches the "hotfix applied to live DB but down-file never written" class
# of failures. The forward .sql alone is not enough — without a paired
# _down.sql we cannot revert, and the discipline gap usually means the
# author also skipped writing the forward source file at apply time.
STAGED_MIGS=$(git diff --cached --name-only --diff-filter=A 2>/dev/null \
  | grep -E '^rls_migrations/[0-9]+_[^/]+\.sql$' \
  | grep -v '_down\.sql$')

MISSING_DOWN=""
for MIG in $STAGED_MIGS; do
  DOWN="${MIG%.sql}_down.sql"
  # Down file must exist either staged in this commit or already in the
  # repo (a stub from a prior commit is fine).
  if ! git ls-files --error-unmatch "$DOWN" >/dev/null 2>&1 \
    && ! git diff --cached --name-only --diff-filter=A 2>/dev/null | grep -qx "$DOWN"; then
    MISSING_DOWN="$MISSING_DOWN  $DOWN\n"
  fi
done

if [ -n "$MISSING_DOWN" ]; then
  echo "Migration gate failed — commit blocked." >&2
  echo "" >&2
  echo "Each new rls_migrations/NNN_*.sql must ship with its _down.sql in the same commit." >&2
  echo "Missing down-migration file(s):" >&2
  printf "%b" "$MISSING_DOWN" >&2
  echo "" >&2
  echo "Write the down-migration that reverts the change, stage it, and recommit." >&2
  exit 2
fi

# ── Gate 1b: migration number must equal the next safe number ──
#
# Catches duplicate migration numbers (cloud-session collision, copy-paste
# of an existing file). Exits 2 on CONFLICT; allows GAP WARNING through.
for MIG in $STAGED_MIGS; do
  MIG_OUT=$(bash "$ROOT/skills/scripts/check-next-migration.sh" "$MIG" 2>&1)
  MIG_EXIT=$?
  if [ $MIG_EXIT -eq 2 ]; then
    echo "Migration numbering gate failed — commit blocked." >&2
    echo "" >&2
    echo "$MIG_OUT" >&2
    echo "" >&2
    echo "Rename the migration file to the next safe number and recommit." >&2
    exit 2
  fi
done

# ── Gate 1c: rpc-columns check for any function defined in staged migrations ──
#
# Catches stale column refs in RPC bodies before they reach the live DB.
# Runs only when the migration defines at least one function. Anchored on
# CREATE so DROP FUNCTION lines (mandatory before a param-type-change
# CREATE OR REPLACE, per CLAUDE.md) don't feed a dropped function name into
# check-rpc-columns.sh and falsely block the commit.
for MIG in $STAGED_MIGS; do
  FN_NAMES=$(grep -oE 'CREATE[^(]*FUNCTION[[:space:]]+[a-z_]+' "$ROOT/$MIG" 2>/dev/null | grep -oE '[a-z_]+$' | sort -u)
  for FN_NAME in $FN_NAMES; do
    RPC_OUT=$(bash "$ROOT/skills/scripts/check-rpc-columns.sh" "$FN_NAME" 2>&1)
    RPC_EXIT=$?
    if [ $RPC_EXIT -ne 0 ]; then
      echo "RPC columns gate failed for $FN_NAME — commit blocked." >&2
      echo "" >&2
      echo "$RPC_OUT" >&2
      exit 2
    fi
  done
done

# ── Gate 1d: Hard-Rule advisories on staged migrations (WARN, never block) ──
#
# Three heuristic checks that surface the Hard Rule 9 / 10 / 12 failure classes
# at commit time. They are ADVISORY, not blocking: each is a heuristic (a
# returned field may be intentionally server-only; an RPC name may match by
# coincidence; a topic is built at runtime), and a false positive that BLOCKED
# a commit would tempt disabling the hook — which CLAUDE.md forbids. So they
# print a loud warning and let the commit through. The standalone scripts exit
# non-zero for use as real gates in the dev-loop proof gate.
#
# Scope: reuses $STAGED_MIGS (added-only, like the sibling gates above), which
# matches this repo's append-only migration convention (each change = a new NNN
# file). An in-place EDIT of an existing migration gets no commit-time advisory
# here; the standalone scripts default to added+modified (ACM), so the dev-loop
# proof gate still covers that case.
#   - check-mapper-sync.sh       Hard Rule 12 (RPC field returned, no mapper reads it — the is_self class)
#   - check-audit-events.sh      Hard Rule 9  (player-self write RPC with no audit_events trace)
#   - check-realtime-subscriber.sh Hard Rule 10 (server realtime.send with no client subscriber)
#   - check-rpc-consumers.sh      Hard Rule 14 (multi-app RPC whose consumers aren't recorded in RPCS.md)
if [ -n "$STAGED_MIGS" ]; then
  ADVISORY=""
  for CHK in check-mapper-sync check-audit-events check-realtime-subscriber check-rpc-consumers; do
    OUT=$(bash "$ROOT/skills/scripts/$CHK.sh" $STAGED_MIGS 2>&1)
    if [ $? -ne 0 ]; then
      ADVISORY="$ADVISORY\n$OUT\n"
    fi
  done
  if [ -n "$ADVISORY" ]; then
    echo "════════════════════════════════════════════════════════════════" >&2
    echo "  HARD-RULE ADVISORY (commit NOT blocked — review before pushing)" >&2
    echo "════════════════════════════════════════════════════════════════" >&2
    printf "%b" "$ADVISORY" >&2
    echo "════════════════════════════════════════════════════════════════" >&2
  fi
fi

# ── Gate 2: build must pass ──
OUTPUT=$(bash skills/scripts/check-build.sh 2>&1)
EXIT=$?

if [ $EXIT -eq 0 ]; then
  exit 0
fi

echo "Build failed — commit blocked. Fix the build first." >&2
echo "" >&2
echo "$OUTPUT" | tail -60 >&2
exit 2
