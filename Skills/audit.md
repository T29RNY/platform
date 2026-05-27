# SKILL: Audit
## Step 1 of AUDIT → EXECUTE → VERIFY → COMMIT → POST-DEPLOY

Triggered when: a new task begins.
Mode: plan mode (Shift+Tab twice). No edits.
Exit condition: developer says "proceed" or "looks right".
Gate: DEVELOPER MUST CONFIRM before execute starts.

---

## PURPOSE

Understand the full scope of the change before touching anything.
An audit that misses a call site or a schema mismatch is worse than
no audit — it creates false confidence going into execute.

---

## WHAT TO READ

Read every file relevant to the change. At minimum:

**For any JS change:**
- The file being changed (in full)
- Every file that imports from it
- The relevant section of App.jsx (routing, state, props passed down)

**For any Supabase/RPC change:**
- `SCHEMA.md` — columns, types, constraints for every table touched
- `RPCS.md` — existing RPC inventory; check before writing a new one
- The relevant migration file in `rls_migrations/`
- `packages/core/storage/supabase.js` — the wrapper for every RPC involved
- `packages/core/index.js` — barrel export status

**For any RLS or security change:**
- The RLS policies on every affected table (via `pg_policies`)
- The SECURITY DEFINER status of every affected RPC (via `pg_proc`)
- Whether `SET search_path` is set on every SECURITY DEFINER function

**Reference files (read as needed, not every audit):**
- `BUGS.md` — always read at session start
- `DECISIONS.md` — settled decisions that constrain the approach
- `CONTEXT.md` — infrastructure, tokens, session history

---

## WHAT TO REPORT

Report all of the following. Do not summarise — be specific.

**1. Current state**
What does the code do now? What does the DB schema look like now?
State the exact function signatures, column names, and types.

**2. Call sites**
Every place the function, component, or RPC is called.
File path, line number, arguments passed, argument order.

**3. Props and state**
For component changes: what props are received, what state is managed,
what is passed down to children.

**4. Schema alignment**
For every column the change reads or writes:
- Does the column exist in the DB with the right type?
- Is it nullable? If so, is there a null guard in JS?
- Does the JS expectation match the RPC return shape?

**5. RLS exposure**
Answer the three questions from CLAUDE.md:
- Who is the caller? (anon / authenticated / admin token)
- Direct table access or RPC?
- Does an RPC already exist for this?

**6. RPC coverage**
- Does an RPC exist in RPCS.md for the required write?
- Is it SECURITY DEFINER?
- Is `SET search_path` set?
- Is it granted to the right role?
- Is it REVOKED from anon if authenticated-only?

**7. Risk flags**
Anything that could go wrong. Specifically:
- Stale column references (check migration history)
- Overloaded RPC signatures (causes "could not choose best candidate" error)
- Schema cache staleness (PostgREST may serve old signature)
- Call sites with wrong argument order (silent failure — compiles clean)
- Demo team limitations (not valid for auth or RLS testing)

**8. Scope of change**
List every file that will need to change in execute.
Be explicit. If you are uncertain whether a file needs changing, say so.

**9. Casual-flow surfaces touched (Phase 5+ only)**
If the change touches `apps/inorout/src/` or `packages/core/`, list
every casual-flow surface from `skills/casual-regression.md` Step 1
that the change risks affecting. Note which need a post-cycle
regression check. This is the input to the casual-regression
gate before commit.

**10. Forward consumers (for new RPCs)**
If the change adds a new RPC, list every downstream consumer —
including ones that don't exist yet (Phase 4 reception display,
Phase 6 HQ dashboard, Phase 7 AI). This list goes into RPCS.md's
Notes column per hard-rule #14.

---

## AUDIT OUTPUT FORMAT

```
AUDIT: [task name]

FILES READ:
  [list every file read with path]

CURRENT STATE:
  [what the code does now]

FUNCTION SIGNATURES:
  [exact signatures of everything touched]

CALL SITES:
  [file:line — function(arg1, arg2)]

SCHEMA:
  [column: type, nullable, matches JS expectation?]

RLS / RPC:
  Caller: [anon / authenticated / admin token]
  Access: [direct / RPC]
  RPC exists: [yes/no — name if yes]
  SECURITY DEFINER: [yes/no]
  SET search_path: [yes/no]
  Granted to: [role]

RISK FLAGS:
  [numbered list, or "none"]

EXECUTE SCOPE:
  [numbered list of files to change]
```

---

## HARD STOPS

Do not proceed to execute if any of the following are unresolved:

- A call site uses an argument order you cannot confirm is correct
- A schema column referenced in the change does not exist in the DB
- An RPC is not SECURITY DEFINER and writes to a locked table
- An RPC overload exists that could cause a routing error
- You cannot determine who the caller is (anon vs authenticated)

If any of these apply: ask ONE clarifying question. Do not guess.
Do not proceed until the developer responds.

---

## READ NEXT
skills/execute.md — begin execute only after developer confirms audit.
