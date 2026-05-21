#!/bin/bash
# PreToolUse hook for Bash. If the command being run is `git commit`,
# run skills/scripts/check-build.sh and block on failure.
#
# Exit codes:
#   0 — not a commit, OR build passed
#   2 — build failed; commit is blocked

ROOT="/Users/tarny/platform"

PAYLOAD=$(cat)
CMD=$(echo "$PAYLOAD" | jq -r '.tool_input.command // empty')

# Match `git commit` anywhere in the command, but not `git commit-tree`
# or branch names that happen to contain the word "commit".
if ! echo "$CMD" | grep -Eq '(^|[^a-zA-Z0-9_-])git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

OUTPUT=$(cd "$ROOT" && bash skills/scripts/check-build.sh 2>&1)
EXIT=$?

if [ $EXIT -eq 0 ]; then
  exit 0
fi

echo "Build failed — commit blocked. Fix the build first." >&2
echo "" >&2
echo "$OUTPUT" | tail -60 >&2
exit 2
