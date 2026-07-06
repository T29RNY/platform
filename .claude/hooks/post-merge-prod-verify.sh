#!/bin/bash
# .claude/hooks/post-merge-prod-verify.sh
# PostToolUse(Bash) auto-trigger — after a `gh pr merge` completes in an ACTIVE
# session, nudge the assistant to run the formal post-deploy check (/prod-verify).
#
# WHY a nudge and not a silent auto-run: prod-verify walks LIVE production and can
# launch fix cycles, so its own hard rule is "supervised, never scheduled-unattended".
# A merge the assistant just ran IS supervised — the operator tapped merge and is
# present — which is exactly prod-verify's definition of "supervised". This hook only
# fires in that in-session window; it does NOT (and must not) run prod-verify against
# prod on a cron / detached loop. The dev-loop merge step is the primary trigger; this
# hook is the safety net that also catches a one-off `gh pr merge` outside that flow.
#
# Hook contract: receives the tool call as JSON on stdin. This is a PostToolUse hook —
# the command has already run. It never blocks (always exit 0); it only emits
# additionalContext so the assistant proceeds to /prod-verify once the deploy is Ready.
# Every non-`gh pr merge` Bash command exits 0 silently and instantly.

INPUT=$(cat)

# Fast bail — the overwhelming majority of Bash calls contain no "merge" at all, so skip
# the python spawn entirely for them (keeps this PostToolUse hook genuinely instant on
# every non-merge command). Only a payload that mentions "merge" is worth parsing.
printf '%s' "$INPUT" | grep -q 'merge' || exit 0

# Pull the command string out of the JSON tool_input (same pattern as pre-push-guard).
CMD=$(printf '%s' "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
[ -z "$CMD" ] && CMD="$INPUT"

# Strip the CONTENTS of quoted strings before matching, so a command that only MENTIONS
# "gh pr merge" inside a quoted argument — a git commit message, an echo, a PR body —
# cannot trip the hook. Only a real *unquoted* invocation should fire. (This hook's own
# commit was the first false positive: its message described `gh pr merge` shapes, and
# an unstripped match fired on PR #0.) A genuine `gh pr merge 303 -m "msg"` still matches:
# the invocation itself is unquoted; only the "msg" span is removed.
CMD=$(printf '%s' "$CMD" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")

# Only fire on a real `gh pr merge` invocation — not gh pr view/checks/create, and not
# the substring "merge" appearing elsewhere. Require: gh, optional flags, "pr", "merge".
# The trailing boundary accepts whitespace, end-of-line, OR a shell separator/paren so a
# no-argument `gh pr merge;` / `(gh pr merge)` / `gh pr merge&&…` still fires.
printf '%s' "$CMD" | grep -Eq '(^|[[:space:]&|;(])gh([[:space:]]+-[^[:space:]]+)*[[:space:]]+pr[[:space:]]+merge([[:space:];)&|]|$)' || exit 0

# Ignore invocations that merge nothing right now: help/usage, and --auto (which only
# ENABLES auto-merge — the real merge lands later via GitHub with no gh command to hook,
# so nudging prod-verify now would be premature).
printf '%s' "$CMD" | grep -Eq -- '(^|[[:space:]])(-h|--help|--auto)([[:space:]]|$)' && exit 0

# Best-effort PR number: the first bare integer, or a .../pull/<n> URL, after "merge".
AFTER=$(printf '%s' "$CMD" | sed -E 's/.*[[:space:]]merge[[:space:]]+//')
PRNUM=$(printf '%s' "$AFTER" | grep -oE 'pull/[0-9]+|(^|[[:space:]])[0-9]+' | grep -oE '[0-9]+' | head -1)

if [ -n "$PRNUM" ]; then
  PR_REF="#$PRNUM"
  PV_ARG="$PRNUM"
else
  # `gh pr merge` with no number merges the current branch's PR — let prod-verify resolve it.
  PR_REF="the just-merged PR (current branch)"
  PV_ARG=""
fi

CONTEXT="PROD-VERIFY AUTO-TRIGGER: a \`gh pr merge\` just ran for ${PR_REF}. This is the \
supervised post-deploy window (the operator merged and is present), so complete the formal \
Step-5 POST-DEPLOY now — do not skip it and do not defer it to a schedule:
  1. Confirm the merge actually succeeded (gh pr view ${PV_ARG:-<PR#>} --json state,mergedAt → MERGED). If it did not merge, stop — nothing to verify.
  2. Wait for the own-app Vercel production deploy to go Ready (never walk a stale bundle).
  3. Run /prod-verify ${PV_ARG:-<PR#>} — a SUPERVISED, demo-only live walk. Keep it inside prod-verify's guardrails (live prod = demo surfaces only, read-mostly, never a real team, never unattended).
This trigger fires only in-session; it is NOT a licence to run a prod-facing walk detached/scheduled."

# PostToolUse context injection. Emit the documented JSON so the assistant reliably
# receives it; the dev-loop merge step is the belt-and-braces fallback if a harness
# build ignores additionalContext.
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
  "$(printf '%s' "$CONTEXT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")"

exit 0
