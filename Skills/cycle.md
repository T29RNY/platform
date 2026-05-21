# SKILL: Deployment Cycle
## The conductor for AUDIT → EXECUTE → VERIFY → COMMIT → POST-DEPLOY

Read this skill at the start of any task that will change code.
It owns the sequence. Individual skills own their step.

---

## THE SEQUENCE

```
AUDIT → EXECUTE → VERIFY → COMMIT → POST-DEPLOY
```

Every code change follows this sequence without exception.
The cycle never runs backwards. No step is skipped.

---

## STEP 1 — AUDIT
Read: skills/audit.md
Mode: plan mode (Shift+Tab twice). No edits.
Start: immediately, before any other action.
End: developer says "looks right" or "proceed".
Gate: DEVELOPER MUST CONFIRM before execute starts.

---

## STEP 2 — EXECUTE
Read: skills/execute.md
Mode: normal (agent) mode.
Start: only after developer confirms audit.
End: all parts complete, build passes clean.
Then: immediately read skills/verify.md and begin verify.
Do not wait for developer instruction to move to verify.

---

## STEP 3 — VERIFY
Read: skills/verify.md
Mode: normal mode. No new edits — checks only.
Start: immediately after execute completes.
End: all script checks pass, all AI checks pass.
Gate: DEVELOPER MUST CONFIRM before commit starts.
Report full verify results and wait for approval.

---

## STEP 4 — COMMIT
Read: skills/commit.md
Mode: normal mode.
Start: only after developer approves verify output.
End: push confirmed, working tree clean, CONTEXT.md updated.
Gate: DEVELOPER MUST CONFIRM before post-deploy starts.
After push, report commit hash and say:
"Committed and pushed. Ready to run post-deploy checks
against the live site. Confirm when ready."
Do not begin post-deploy until developer says proceed.

---

## STEP 5 — POST-DEPLOY
Read: skills/post-deploy.md
Mode: normal mode.
Start: only after developer confirms post-deploy gate.
End: all live checks pass. Cycle closed.
Then: report "Cycle closed." Wait for next task.

---

## DEVELOPER GATES — THREE REQUIRED APPROVALS

The developer must actively approve at three points:

1. After AUDIT — confirm approach before any editing starts
2. After VERIFY — confirm change is correct before committing
3. After COMMIT — confirm before touching the live site

Rationale for gate 3: post-deploy runs Playwright against
the live site and queries the live Supabase database.
The developer should know when their production environment
is being tested and explicitly choose when that happens.

Everything between gates — execute → verify and the steps
within each — runs automatically without prompting.

---

## WHEN A STEP FAILS

AUDIT reveals something unexpected:
→ Ask one clarifying question. Do not proceed until resolved.

EXECUTE build fails:
→ Fix in the same part. Do not move to next part.
→ Do not move to verify with a failing build.

VERIFY check fails:
→ Fix the specific failure.
→ Re-run all checks that could be affected by the fix,
  not just the one that failed — a fix may touch files
  that invalidate earlier checks.
→ Report all re-run results before proceeding to commit.

COMMIT fails (git push rejected):
→ Do not force push. Report to developer immediately.

POST-DEPLOY fails:
→ Do not treat cycle as closed.
→ Diagnose before proposing a fix.
→ If a hotfix is needed, restart the full cycle from AUDIT.

---

## TRIVIAL CHANGES

For single-line copy fixes, colour tweaks, or comment updates:

- AUDIT: abbreviated — read the one file, confirm no side effects
- EXECUTE: make the change
- VERIFY: run check-build.sh and check-hygiene.sh only
- COMMIT: normal
- POST-DEPLOY: player view + admin view load check only

State explicitly: "This is a trivial change — running
abbreviated cycle." All three developer gates still apply.

---

## SCRIPTS AVAILABLE

All deterministic checks are in skills/scripts/.
Do not re-implement these inline — call the scripts.

```
bash skills/scripts/check-build.sh
bash skills/scripts/check-hygiene.sh
bash skills/scripts/check-references.sh "term" [--rpc|--removed]
bash skills/scripts/check-rpc-security.sh rpc_name
bash skills/scripts/check-db-schema.sh table_name
```

check-rpc-security.sh and check-db-schema.sh output
Supabase MCP action blocks. Claude Code must execute
these via Supabase MCP — not read and interpret them.

---

## RESUMING AN ABANDONED CYCLE

If a session was closed mid-cycle, or you are returning
to a task after a gap, do not assume the prior cycle
context is still valid. Session memory does not persist.

Run these steps before doing anything else:

**1. Check what is staged or modified**
Run: git status
Report every staged and unstaged file.

**2. Check the last commit**
Run: git log --oneline -5
Report the last 5 commits and identify which step the
last cycle reached.

**3. Assess cycle state**

If git status is CLEAN (nothing staged or modified):
→ The last cycle completed or was fully reverted.
→ Start a fresh cycle from AUDIT.

If files are STAGED but not committed:
→ The cycle was abandoned during EXECUTE or after VERIFY.
→ Run check-build.sh to confirm build state.
→ If build passes: treat as if EXECUTE just completed.
  Resume from VERIFY — do not skip it.
→ If build fails: unstage everything (git reset HEAD),
  report to developer, restart from AUDIT.

If files are MODIFIED but not staged:
→ Execute was in progress and abandoned mid-part.
→ Review the diff (git diff) and report what was changed.
→ Ask developer: complete this part, or discard and restart?
→ Do not stage partial changes without developer confirmation.

**4. Re-run AUDIT before any new execute**

Even if resuming a cycle that had a confirmed audit,
re-run the audit if any of these are true:
- More than one working session has passed since the audit
- The codebase has changed since the audit (check git log)
- The original audit scope is unclear from the session context

A stale audit is worse than no audit — it creates false
confidence. When in doubt, re-audit.
