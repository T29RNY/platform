# SKILL: Post-Deploy
## Step 5 of AUDIT → EXECUTE → VERIFY → COMMIT → POST-DEPLOY

> **Executable form: `/prod-verify`** (`.claude/skills/prod-verify/SKILL.md`).
> This file is the reference spec for the post-deploy step; `/prod-verify` is the
> invocable skill that runs it — it confirms the deploy is live, DERIVES which
> surfaces to walk from the merged diff (tests what changed, not everything), runs
> the supervised demo-only live walk below, and classifies each failure T1 (→ a
> `/dev-loop` fix) or T3 (→ surface to the operator). Invoke `/prod-verify [PR#]`
> after a merge; the steps below are what it executes.

Triggered when: developer confirms post-deploy gate after commit.
Mode: normal mode. Read-only — no edits, no DB writes.
Exit condition: all live checks pass. Developer closes the cycle.
Gate: DEVELOPER MUST CONFIRM before this step starts.

---

## PURPOSE

Confirm the change works on the live site and live database —
not just in a build. Pre-deploy verify catches code correctness.
Post-deploy catches integration issues: RPC not applied, schema
cache stale, environment variable missing, CDN serving old bundle.

---

## WHAT THIS STEP IS NOT

- Not a repeat of verify. The script checks already ran.
- Not a full regression suite. Check the changed flow and adjacent flows.
- Not optional. A cycle is not closed until post-deploy passes.

---

## STEP 1 — CONFIRM DEPLOYMENT

Verify the commit is live before testing anything.

Check the Vercel deployment:
- Confirm the latest commit hash matches what was pushed
- Confirm deployment status is "Ready" (not "Building" or "Error")
- If still building: wait. Do not run live checks against a stale bundle.

---

## STEP 2 — LIVE UI CHECKS

**Player view** (always check unless change is admin-only):
```
https://in-or-out.com/p/p_demotoken_01
```

**Admin view** (always check unless change is player-only):
```
https://in-or-out.com/demoadmin
```

For each view, confirm:
- Page loads without a white screen or JS exception
- The changed flow renders correctly end-to-end
- No 401, 403, 404, or 500 in the network tab
- No JS exceptions in the browser console
- Adjacent flows (screens one step away from the change) still load

**Playwright MCP (preferred):**
Use Playwright MCP to navigate, interact, and capture the network tab.
Report exactly what you observed — screenshots if available.

**Fallback (if Playwright MCP unavailable):**
State: "Playwright MCP not available — manual check required."
Provide the exact URLs and what to look for. Do not skip the check
or mark it PASS without evidence. The developer must confirm manually.

---

## STEP 3 — LIVE DB CHECKS (for RPC or schema changes)

For any change that touched an RPC or the database schema,
query the live database via Supabase MCP.

**Confirm RPC exists and is correctly configured:**
```
bash skills/scripts/check-rpc-security.sh rpc_name
```
Then run the generated SQL via Supabase MCP. Confirm:
- `security_definer = true`
- `overload_count = 1`
- Correct grants

**Confirm schema matches expectations:**
```
bash skills/scripts/check-db-schema.sh table_name
```
Then run the generated SQL via Supabase MCP. Confirm
every column the change reads or writes exists with the correct type.

**Spot-check the happy path with real data:**
Run a representative query for the changed flow via Supabase MCP
`execute_sql`. Confirm it returns data in the expected shape.

Do NOT use demo team data for auth or RLS checks.
Use team_finbars or a real team for those flows.

---

## STEP 4 — SCHEMA CACHE

If the change added or modified an RPC and the live call returns
404 or a "function does not exist" error even though the DB check
passed, the PostgREST schema cache is stale.

Flush it:
```sql
SELECT pg_notify('pgrst', 'reload schema');
```
Run via Supabase MCP. Wait 30 seconds. Retest.

---

## POST-DEPLOY OUTPUT FORMAT

```
POST-DEPLOY: [task name]

DEPLOYMENT:
  Commit: [hash]
  Vercel status: Ready / Building / Error

UI CHECKS:
  Player view: PASS / FAIL / MANUAL REQUIRED
  Admin view:  PASS / FAIL / MANUAL REQUIRED / N/A
  [detail any failures or observations]

DB CHECKS:
  RPC security: PASS / FAIL / N/A
  Schema:       PASS / FAIL / N/A
  Happy path:   PASS / FAIL / N/A

SCHEMA CACHE: flushed / not needed
```

---

## IF A CHECK FAILS

Do not close the cycle. Do not mark it as done.

1. Report the failure with the exact error message or observation.
2. Diagnose before proposing a fix.
3. If a hotfix is needed: start a new full cycle from audit.md.
   Do not patch live without going through the full cycle again.

---

## CLOSING THE CYCLE

When all checks pass:

```
Cycle closed.
[summary of what was deployed and verified]
```

Wait for the next task.
