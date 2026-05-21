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

OUTPUT=$(cd "$ROOT" && bash skills/scripts/check-build.sh 2>&1)
EXIT=$?

if [ $EXIT -eq 0 ]; then
  exit 0
fi

echo "Build failed — commit blocked. Fix the build first." >&2
echo "" >&2
echo "$OUTPUT" | tail -60 >&2
exit 2
