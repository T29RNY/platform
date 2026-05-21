# SKILL: Feature Plan
## Convert a FEATURES.md backlog row into a structured audit packet

Triggered when: starting work on a new feature from the backlog.
Mode: read-only. No edits. Stops at the audit boundary.
Exit condition: structured plan produced. Developer confirms before
skills/audit.md begins.

---

## PURPOSE

New features involve schema decisions, RPC design, RLS implications,
and UI surfaces that all interact. Without a plan, audit.md starts
without context and misses integration points. This skill does the
upfront research so that audit.md can be targeted and complete.

This skill does not write code. It produces the plan that audit.md
consumes. The developer must confirm the plan before execute starts.

---

## STEP 1 — READ THE FEATURE

Read FEATURES.md. Find the relevant backlog entry.

Extract:
- Feature name and one-line description
- Phase it belongs to
- Any notes or constraints already recorded
- Dependencies on other features (blocked by / blocks)

---

## STEP 2 — GROUND IN THE CURRENT STATE

Read the following, in order:

**SCHEMA.md** — what tables and columns exist that this feature touches?
Are any new columns or tables needed?

**RPCS.md** — what RPCs already exist that this feature can reuse?
What new RPCs will be needed?

**DECISIONS.md** — are there settled decisions that constrain the design?
(e.g. all writes via SECURITY DEFINER RPCs, no direct table access from client)

**IO_INTELLIGENCE.md** — if the feature involves an IO Intelligence card,
read the full card spec, eligibility threshold, locked/unlocked variant,
and unlock grid position.

---

## STEP 3 — IDENTIFY THE FULL SCOPE

Produce answers to these questions:

**Schema:**
- What new tables or columns are needed?
- What existing columns are read or written?
- What indexes are needed?

**RPCs:**
- What existing RPCs cover this feature (full or partial)?
- What new RPCs are needed? What are their signatures?
- Who is the caller for each? (anon / authenticated / admin token)
- What does each return? (jsonb shape)

**RLS:**
- Which tables does this feature access?
- What is the access pattern? (read, write, or both)
- Are existing policies sufficient, or do new ones need adding?

**UI:**
- Which screens are affected?
- What new components are needed?
- What props flow to them? From where in App.jsx?

**Risk flags:**
- Any schema column that may not exist yet
- Any RPC that might have a stale column reference after this change
- Any state wrapper that might need updating (check: must stay pure)
- Demo team limitations that affect testing

---

## STEP 4 — PRODUCE THE PLAN

Output a structured plan in this format:

```
FEATURE PLAN: [feature name]

PHASE: [phase from FEATURES.md]
DESCRIPTION: [one sentence]

SCHEMA CHANGES:
  New tables: [list, or "none"]
  New columns: [table.column — type, constraints]
  Indexes: [list, or "none"]

NEW RPCs:
  [rpc_name(params)] → jsonb
    Caller: [anon / authenticated / admin token]
    Returns: [shape]
    Tables touched: [list]
    Security: SECURITY DEFINER, SET search_path, GRANT TO [role]

EXISTING RPCs REUSED:
  [rpc_name] — [why it covers this feature]

RLS IMPLICATIONS:
  [table]: [existing policy sufficient / new policy needed]

UI SURFACES:
  [ScreenName.jsx] — [what changes]
  New components: [list, or "none"]
  Props: [what flows from App.jsx and how]

RISK FLAGS:
  [numbered list, or "none"]

EXECUTE ORDER (proposed):
  1. [SQL: new table or column] — apply via Supabase MCP
  2. [RPC: rpc_name] — apply via Supabase MCP
  3. [JS: supabase.js wrapper + index.js barrel]
  4. [UI: component or screen]
  5. ...

TEST PLAN:
  Demo: [what to verify at /demoadmin or /p/p_demotoken_01]
  Real team: [if auth/RLS involved, use team_finbars]
  DB: [MCP queries to confirm data was written correctly]
```

---

## STEP 5 — STOP

Present the plan. Do not begin audit.md until the developer confirms.

The developer may:
- Approve and proceed to audit.md
- Adjust scope (add or remove items)
- Defer the feature

Do not start audit.md based on implied approval. Wait for explicit
confirmation.

---

## READ NEXT
skills/audit.md — begin only after developer confirms the feature plan.
