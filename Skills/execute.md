# SKILL: Execute
## Step 2 of AUDIT → EXECUTE → VERIFY → COMMIT → POST-DEPLOY

Triggered when: developer confirms audit output.
Mode: normal (agent) mode. Edits allowed.
Exit condition: all parts complete, build passes clean.
Gate: developer confirmed audit before this step started.

---

## PURPOSE

Make exactly the changes agreed in audit — no more, no less.
Execute is where bugs get introduced. Scope creep here causes
failures that are expensive to diagnose in verify.

---

## RULES

**1. One logical unit at a time.**
Split the execute into parts. Each part is one file or one
coherent change (e.g. "update the RPC" is one part,
"update the JS wrapper" is the next). Complete each part
fully before starting the next.

**2. SQL first, always.**
If the change involves a new or modified RPC:
- Apply the SQL via Supabase MCP first.
- Confirm the function exists in `pg_proc` before touching JS.
- Never write a JS wrapper for an RPC that is not yet deployed.

**3. Build after every part.**
```
cd apps/inorout && npm run build
```
If dependencies in packages/ changed:
```
cd ../.. && npm install && cd apps/inorout && npm run build
```
Do not proceed to the next part with a failing build.
Fix the failure in the same part.

**4. Make only what was agreed.**
If you notice something unrelated that should be fixed:
- Note it but do not touch it.
- Report it after verify is complete.
- It goes on the backlog, not into this execute.

**5. No console.log.**
Use `console.error` for all error paths.

**6. No direct table writes.**
Every Supabase write goes through a SECURITY DEFINER RPC.
No exceptions.

---

## EXECUTE PART FORMAT

State clearly before each part:

```
PART [N]: [what this part changes]
File: [path]
```

After each part, run the build and report:

```
Build: PASS / FAIL
```

If FAIL: fix it now. Do not move to part N+1 with a broken build.

---

## AFTER THE FINAL PART

When all parts are complete and the build passes clean:

```
Execute complete.
Parts: [N]
Files changed: [list]
Build: PASS
```

Then immediately read skills/verify.md and begin verify.
Do not wait for developer instruction to move to verify.

---

## WHAT NOT TO DO

- Do not rename or refactor while fixing a bug.
- Do not add error handling for scenarios that cannot happen.
- Do not add comments explaining what the code does —
  well-named identifiers already do that.
- Do not add features beyond the agreed scope.
- Do not stage or commit during execute — that happens in commit.md.
- Do not call `git add -A` at any point — verify reviews the
  diff first. Unstaged changes are intentional at this stage.

---

## RPC EXECUTE CHECKLIST

When adding or modifying an RPC, confirm each item before
moving to the JS wrapper:

- [ ] SECURITY DEFINER is set
- [ ] SET search_path TO 'public', 'pg_temp' is set
- [ ] REVOKE ALL FROM PUBLIC (before any GRANT)
- [ ] GRANT EXECUTE TO the correct role (anon or authenticated)
- [ ] auth.uid() used server-side — no trusted user_id param
- [ ] Returns jsonb
- [ ] No stale column references (check against SCHEMA.md)
- [ ] Overload count is 1 (DROP old signature if changing types)
- [ ] If the return shape adds a field that JS reads, update the
      mapper in `packages/core/storage/supabase.js` (`dbToPlayer`,
      `dbToTeam`, inline shapes in `getTeamStateBy*`) in the SAME
      commit. Grep the new field name — must appear in BOTH the
      RPC body AND the mapper. CLAUDE.md hard rule #12.

---

## READ NEXT
skills/verify.md — begin immediately after execute completes.
