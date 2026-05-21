# SKILL: Verify
## Step 3 of AUDIT → EXECUTE → VERIFY → COMMIT → POST-DEPLOY

Triggered when: execute is complete and build passes.
Prerequisite: execute.md completed, all parts done.
Exit condition: all checks pass. Developer approves commit.

---

## PURPOSE

Prove the change is correct and complete before it goes
into the codebase permanently. Scripts handle the
deterministic checks. AI handles the judgment calls.

---

## DETERMINISTIC CHECKS — RUN SCRIPTS FIRST

These produce binary pass/fail results. Run all four.
Do not proceed to AI checks until all scripts pass.

**1. Build**
```
bash skills/scripts/check-build.sh
```
Must be clean with zero warnings.

**2. Code hygiene — entire codebase**
```
bash skills/scripts/check-hygiene.sh
```
Checks: console.logs, hardcoded colours, icon weight,
banned display text, direct table writes, raw RPC names.
All 6 checks must pass.

**3. Reference checks — for every term changed**

For each function or variable that was REMOVED:
```
bash skills/scripts/check-references.sh "removedTerm" --removed
```
Expected: zero results.

For each new RPC (snake_case name):
```
bash skills/scripts/check-references.sh "rpc_name" --rpc
```
Expected: exactly ONE supabase.rpc() call in supabase.js.

For each new JS wrapper (camelCase name):
```
bash skills/scripts/check-references.sh "wrapperName"
```
Expected: supabase.js definition + index.js export + call site.

**4. DB schema — for every table touched**
```
bash skills/scripts/check-db-schema.sh table_name
```
Run output SQL via Supabase MCP. Verify every column the
change reads or writes exists with the correct type.

**5. RPC security — for every RPC added or modified**
```
bash skills/scripts/check-rpc-security.sh rpc_name
```
Run output SQL via Supabase MCP.
prosecdef must be TRUE. overload_count must be 1.

---

## AI CHECKS — REQUIRE JUDGMENT

Run these after all scripts pass.

**CHECK 6 — Call site argument order**
For every function whose signature changed:
- Review each call site found in the reference scan
- Verify argument ORDER matches the new signature
- This cannot be scripted reliably — argument order bugs
  compile clean but cause silent runtime failures

**CHECK 7 — Git diff scope**
```
git diff --staged
```
Review the full diff. Flag anything that:
- Was not part of the agreed change
- Touches a file not in the audit scope
- Removes or adds more than intended
- Looks like an accidental edit

Scope creep in diffs is a common source of bugs.
The diff must match the audit scope exactly.

**CHECK 8 — Playwright UI check**
Using Playwright MCP, open the affected flow.

Player-facing change: https://in-or-out.com/p/p_demotoken_01
Admin-facing change: https://in-or-out.com/demoadmin
Auth/RLS change: use team_finbars not demo

Confirm:
- Change renders correctly
- No visual regressions on adjacent elements
- No new JS errors in console (401, 500, JS exceptions)
- No failed API calls in network tab

**Fallback (if Playwright MCP unavailable):**
State: "Playwright MCP not available — manual check required."
Provide the exact URL and what to look for. Do not mark PASS
without evidence. Developer must confirm manually before proceeding.

---

## VERIFY OUTPUT FORMAT

SCRIPT RESULTS:
  Build: PASS / FAIL
  Hygiene: PASS / FAIL [list any failures]
  Removals: PASS / FAIL [terms checked]
  RPC references: PASS / FAIL [rpc names checked]
  DB Schema: PASS / FAIL [tables checked]
  RPC Security: PASS / FAIL [prosecdef, search_path, overload count]

AI CHECKS:
  Call site arg order: PASS / FAIL
  Git diff scope: PASS / FAIL [any scope creep noted]
  Playwright: PASS / FAIL [what was tested]

If any check is FAIL:
→ Fix the specific failure.
→ Re-run ALL checks that could be affected by the fix —
  not just the one that failed. A fix may touch files that
  invalidate earlier reference scans or hygiene checks.
→ Report every re-run result before proceeding to commit.
→ If the fix is non-trivial, consider returning to EXECUTE
  and treating this as a new execute-verify cycle.
If all pass: "Verify complete. Ready to commit."
Proceed immediately to commit.md.

---

## READ NEXT
skills/commit.md — begin commit after developer approves verify output.
