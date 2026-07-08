#!/bin/bash
# PostToolUse hook for Edit/Write/MultiEdit.
# Runs skills/scripts/check-hygiene.sh on the changed file if it
# lives under apps/inorout/src/ or packages/core/. Otherwise exits 0.
#
# Exit codes:
#   0 — file out of scope OR all hygiene checks passed
#   2 — one or more hygiene checks failed (Claude Code treats this
#       as "block and surface stderr to the assistant")

ROOT="/Users/tarny/platform"

# Hook receives JSON on stdin: { tool_input: { file_path: "..." }, ... }
PAYLOAD=$(cat)
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Normalise to a path relative to the repo root.
case "$FILE_PATH" in
  "$ROOT"/*) REL="${FILE_PATH#$ROOT/}" ;;
  /*)        exit 0 ;;  # absolute path outside the repo — not ours
  *)         REL="$FILE_PATH" ;;
esac

# Only scan files inside the directories check-hygiene.sh covers.
case "$REL" in
  apps/inorout/src/*|packages/core/*|apps/clubmanager/src/*) ;;
  *) exit 0 ;;
esac

# Only scan source files, not assets/configs.
case "$REL" in
  *.js|*.jsx|*.ts|*.tsx) ;;
  *) exit 0 ;;
esac

OUTPUT=$(cd "$ROOT" && bash skills/scripts/check-hygiene.sh "$REL" 2>&1)
EXIT=$?

if [ $EXIT -eq 0 ]; then
  exit 0
fi

# Failure — surface output on stderr and block.
echo "Hygiene check failed for $REL — fix before continuing." >&2
echo "" >&2
echo "$OUTPUT" >&2
exit 2
