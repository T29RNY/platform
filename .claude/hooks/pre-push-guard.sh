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
  # Is this segment a real `git push` invocation? git, optional global flags
  # (incl. value-flags like `-C <path>` / `-c <cfg>` used with worktrees), then push.
  printf '%s' "$SEG" | grep -Eq '(^|[[:space:]])git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|-[^[:space:]]+))*[[:space:]]+push([[:space:]]|$)' || continue

  # Force-push in any form (--force, --force-with-lease, -f).
  if printf '%s' "$SEG" | grep -Eq -- '--force|--force-with-lease|(^|[[:space:]])-f([[:space:]]|$)'; then
    echo "BLOCKED: force-push is not permitted (dev-loop hard guardrail). Open a PR instead." >&2
    exit 2
  fi

  # Push to main by NAME: bare "main", "HEAD:main", "<branch>:main", ":main".
  if printf '%s' "$SEG" | grep -Eq -- '(^|[[:space:]])(main|[^[:space:]]*:main)([[:space:]]|$)'; then
    echo "BLOCKED: pushing to main is not permitted (dev-loop hard guardrail). Push a feature branch and open a PR." >&2
    exit 2
  fi

  # Push to main by POSITION: the #4c slip. `git push -u origin HEAD` (or a bare
  # `git push` with an upstream) carries NO literal "main" in the string, so the
  # name-based check above can't see it — yet if HEAD is checked out on main it
  # pushes straight to origin/main. dev-loop is branch-first: there is no legitimate
  # push while sitting on main, so resolve HEAD's real branch and block any push from it.
  # Respect an explicit `git -C <dir>` (worktrees); else the hook's cwd.
  REPO_DIR=$(printf '%s' "$SEG" | grep -oE -- '-C[[:space:]]+[^[:space:]]+' | head -1 | sed -E 's/^-C[[:space:]]+//')
  [ -z "$REPO_DIR" ] && REPO_DIR="."
  CUR_BRANCH=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ "$CUR_BRANCH" = "main" ]; then
    echo "BLOCKED: you are on main — pushing from main is not permitted (dev-loop hard guardrail). Even 'git push -u origin HEAD' pushes to origin/main from here. Run: git checkout -b <branch>, then push and open a PR." >&2
    exit 2
  fi
done < <(printf '%s\n' "$CMD" | tr ';&|' '\n')

exit 0
