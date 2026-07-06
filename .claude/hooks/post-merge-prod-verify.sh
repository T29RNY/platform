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

# Only fire when the command STARTS with `gh pr merge` (after optional leading whitespace
# and an optional `(` subshell). This is the robust discriminator between an actual merge
# invocation and the phrase merely APPEARING inside an argument — a git commit message, an
# echo, or a `gh pr create --body "…"` that describes merges. Those all lead with a
# different command (`git`, `echo`, `gh pr create`), so an anchored match can't be tripped
# by their body text, including multi-line heredoc bodies that line-based quote-stripping
# can't reach. (Both false positives this hook caught on itself — its own commit message
# and its own PR body — were exactly that: the phrase mid-command, never at the start.)
# Trade-off, accepted deliberately: a compound `git x && gh pr merge N` won't auto-fire
# (it doesn't lead with gh) — that rarer shape is covered by the dev-loop skill's
# post-merge step, and eliminating the false-positive noise is worth more than catching it.
# Trailing boundary allows a `)` so a bare `(gh pr merge)` subshell still fires.
printf '%s' "$CMD" | grep -Eq '^[[:space:]]*\(?[[:space:]]*gh([[:space:]]+-[^[:space:]]+)*[[:space:]]+pr[[:space:]]+merge([[:space:]);|&]|$)' || exit 0

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
