# SKILL: RPC Security Sweep
## Gate check before any RLS-touching commit

Triggered when: adding or modifying any SECURITY DEFINER RPC, or explicitly
requested before a production deploy.
Mode: read-only. No edits.
Exit condition: all RPCs pass all criteria. Hard stop if any fail.

---

## PURPOSE

Every SECURITY DEFINER function runs as postgres and bypasses RLS.
A misconfigured one is a security hole. A stale one silently fails
at runtime with `internal_error` — the exact failure mode from B1
(session 29: 10 RPCs referencing a dropped column for weeks).

This sweep catches both classes of problem before they reach production.

---

## STEP 1 — GET THE FULL RPC LIST

Run via Supabase MCP:

```sql
SELECT
  proname                  AS name,
  prosecdef                AS security_definer,
  proconfig                AS config,
  proacl::text             AS grants,
  COUNT(*) OVER (
    PARTITION BY proname
  )                        AS overload_count
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosecdef = true
ORDER BY proname;
```

This is the complete list of SECURITY DEFINER RPCs in the project.
Every row must pass the security criteria below.

---

## STEP 2 — SECURITY CRITERIA (every RPC)

For each row returned:

| Check | PASS | FAIL |
|---|---|---|
| `security_definer` | `true` | `false` — RLS not bypassed, writes blocked |
| `config` | contains `search_path=public` | missing — search path injection risk |
| `overload_count` | `1` | `>1` — stale overload causes runtime routing error |
| `grants` | correct role only | `PUBLIC` grant — any caller can invoke |

**If any row fails:** STOP. Do not proceed with the commit.
Fix every failure before continuing.

---

## STEP 3 — COLUMN STALENESS CHECK (RPCs changed in this cycle)

For every RPC that was added or modified in this execute cycle,
run the column staleness check:

```
bash skills/scripts/check-rpc-columns.sh rpc_name_1 [rpc_name_2 ...]
```

Execute each generated MCP block via Supabase MCP.
Compare columns in the function body against information_schema.
Any column referenced in the body that does not exist in the DB is stale.

**Why this matters:** PL/pgSQL validates column references at execution
time, not definition time. `CREATE OR REPLACE` succeeds even with stale
column names — the error only surfaces at runtime as `internal_error`.
(BUGS.md B1: `players.is_vice_captain` referenced in 10 RPCs after
migration 026 moved it to `team_players`.)

---

## STEP 4 — GRANT AUDIT (for new RPCs only)

For any newly created RPC, confirm the grant is intentional:

- **anon grant:** correct for player token routes (`/p/<token>`)
- **authenticated grant:** correct for post-auth flows (`/create`, joins, My Squads)
- **PUBLIC grant:** never correct — always use a specific role

Cross-reference RPCS.md to confirm the intended caller matches the grant.

---

## SWEEP OUTPUT FORMAT

```
RPC SECURITY SWEEP

Total SECURITY DEFINER RPCs: [N]

SECURITY CRITERIA:
  [rpc_name]: PASS / FAIL [reason if fail]
  ...

COLUMN STALENESS (changed RPCs only):
  [rpc_name]: PASS / FAIL [stale column if fail]

GRANT AUDIT (new RPCs only):
  [rpc_name]: PASS / FAIL [issue if fail]

OVERALL: PASS / FAIL
```

If OVERALL = FAIL: list every failure. Do not proceed to commit.md
until all failures are resolved and re-swept.

---

## READ NEXT
skills/commit.md — proceed only after OVERALL = PASS.
