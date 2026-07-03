# SKILL: Schema Sync
## Impact map before any column rename, move, or drop

Triggered when: any ALTER TABLE RENAME COLUMN, column move between tables,
or DROP COLUMN is part of the planned change.
Mode: read-only audit. No edits until full impact is known.
Exit condition: every reference is categorised. Execute plan produced.
Gate: developer confirms impact map before execute starts.

---

## PURPOSE

A column rename or drop silently breaks every SECURITY DEFINER function
that references it. PL/pgSQL validates at execution time — functions
accept the change at definition time and fail at runtime with
`internal_error`. Client code that reads the old column name from RPC
return values also breaks silently.

This skill produces a complete list of everything that must change
before the column is touched. Nothing is missed.

(Reference: BUGS.md B1, session 29 — `players.is_vice_captain` moved to
`team_players.is_vice_captain` in migration 026. 10 deployed RPCs
and `player_get_teams` still referenced the old location. All failed
silently for the duration of session 27 and 28.)

---

## STEP 1 — RUN THE IMPACT GREP

```
bash skills/scripts/check-schema-column.sh table_name column_name
```

This searches:
- `rls_migrations/` — SQL migration files
- `packages/core/storage/supabase.js` — JS wrappers
- `apps/` and `packages/` — components and hooks
- `SCHEMA.md`, `RPCS.md`, `CONTEXT.md` — documentation

And generates two Supabase MCP action blocks:
1. Confirm the column's current state in `information_schema`
2. Find all deployed RPCs whose bodies reference the column

Execute both MCP blocks via Supabase MCP. Report all results.

---

## STEP 2 — CATEGORISE EVERY REFERENCE

For each reference found, assign one of these categories:

| Category | Action |
|---|---|
| **Migration file (the change itself)** | Correct — this is the ALTER TABLE |
| **Migration file (stale reference)** | Must update before applying |
| **Deployed RPC body** | Must rewrite RPC and apply via MCP |
| **supabase.js wrapper** | Must update column name / return shape |
| **Component / hook (reads field)** | Must update field name accessed |
| **Documentation** | Must update SCHEMA.md / RPCS.md |
| **Comment only** | Safe to leave or update |

Anything uncategorised: flag for developer decision before proceeding.

---

## STEP 3 — PRODUCE THE EXECUTE PLAN

Output a numbered list of every file that must change, in the order
they should be changed:

```
SCHEMA SYNC EXECUTE PLAN: [table_name].[column_name]

Impact summary:
  [N] deployed RPCs to rewrite
  [N] JS files to update
  [N] documentation files to update

Execute order:
  1. Apply migration (ALTER TABLE / new column) via Supabase MCP
  2. Rewrite [rpc_name] — apply via Supabase MCP
  3. Rewrite [rpc_name_2] — apply via Supabase MCP
  4. Update supabase.js wrapper [wrapperName] — line [N]
  5. Update [component.jsx] — [field] reference at line [N]
  6. Update SCHEMA.md — [section]

Post-execute:
  bash skills/scripts/check-schema-column.sh [table] [column]   → expect zero hits
  bash skills/scripts/check-rpc-columns.sh [rpc_name] [...]     → expect all PASS
```

---

## HARD STOPS

Do not proceed to execute if:

- Any deployed RPC references the old column and has not been rewritten
- Any JS file reads the old column name from an RPC return value
- The new column location does not have a corresponding index where needed

If the scope is larger than anticipated: ask the developer before
proceeding. A schema change with 10+ references is a bigger execute
than a typical cycle — it may warrant its own dedicated session.

---

## READ NEXT
skills/execute.md — proceed only after developer confirms the execute plan.
After execute: run check-schema-column.sh with --removed semantics
(expect zero hits on the old column name in apps/ and packages/).
Then run rpc-security-sweep.md before commit.
