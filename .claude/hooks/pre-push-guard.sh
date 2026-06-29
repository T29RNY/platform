#!/bin/bash
# .claude/hooks/pre-push-guard.sh
# PreToolUse(Bash) guard — physically blocks any push to main and any force-push.
# The text-match deny in settings.local.json is glob-based and bypassable; this hook
# is the real guarantee (dev-loop hard guardrail: PR-only, never push main).
#
# Hook contract: receives the tool call as JSON on stdin. Exit 2 = block the call.
# Exit 0 = allow. Anything that is not a `git push` is allowed untouched.

INPUT=$(cat)

# Pull the command string out of the JSON tool_input; fall back to the raw payload
# if python isn't available (over-matching only ever errs on the side of blocking,
# and only within a git-push context).
CMD=$(printf '%s' "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
[ -z "$CMD" ] && CMD="$INPUT"

# Split the command on shell separators (; && || | &) and inspect each segment
# independently. Only a segment that actually INVOKES `git push` is policed — so an
# innocent `git add path/to/pre-push-guard.sh` or `git checkout -b x main` is never
# tripped by the substrings "push"/"main" appearing in a filename or branch arg.
while IFS= read -r SEG; do
  # Is this segment a real `git push` invocation? git, optional global flags, then push.
  printf '%s' "$SEG" | grep -Eq '(^|[[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+push([[:space:]]|$)' || continue

  # Force-push in any form (--force, --force-with-lease, -f).
  if printf '%s' "$SEG" | grep -Eq -- '--force|--force-with-lease|(^|[[:space:]])-f([[:space:]]|$)'; then
    echo "BLOCKED: force-push is not permitted (dev-loop hard guardrail). Open a PR instead." >&2
    exit 2
  fi

  # Push to main: bare "main", "HEAD:main", "<branch>:main", ":main".
  if printf '%s' "$SEG" | grep -Eq -- '(^|[[:space:]])(main|[^[:space:]]*:main)([[:space:]]|$)'; then
    echo "BLOCKED: pushing to main is not permitted (dev-loop hard guardrail). Push a feature branch and open a PR." >&2
    exit 2
  fi
done < <(printf '%s\n' "$CMD" | tr ';&|' '\n')

exit 0
