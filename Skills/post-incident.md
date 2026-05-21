# SKILL: Post-Incident
## Formalise documentation after a bug fix

Triggered when: a bug fix has been committed and verified.
Mode: read-only initially, then targeted writes to doc files only.
Exit condition: all affected documentation updated. Developer confirms.

---

## PURPOSE

Every session that fixes a bug should update BUGS.md, and depending
on the fix, may also require updates to DECISIONS.md and CONTEXT.md.
This skill ensures nothing is forgotten and that the documentation
accurately reflects what happened, why, and what rule (if any) changed.

Skipping this step means the next session starts without knowing a
bug was fixed, or without the rule that prevents it recurring.

---

## STEP 1 — READ THE DIFF

```
git log --oneline -3
git diff HEAD~1 HEAD
```

From the diff, identify:
- What files changed?
- What was the root cause of the bug?
- What was the fix approach?
- Did any architectural rule change as a result?

---

## STEP 2 — BUGS.MD UPDATE

Read BUGS.md in full, then propose the following changes:

**If the bug was in the active section:**
- Move it from the active section to "RESOLVED THIS SESSION"
- Add: root cause (one sentence), fix approach (one sentence), commit hash

**If the bug was previously unknown:**
- Add a new entry to "RESOLVED THIS SESSION" with full detail

**Format for resolved entry:**
```
- **[Bug name]** — [root cause in one sentence]. [Fix approach in one
  sentence]. Affected: [list what was broken]. Fixed via [method —
  e.g. apply_migration, JS edit]. Commit: [hash].
```

Also update the header date: `*Last updated: [date] (session [N] — [bug name] resolved)*`

---

## STEP 3 — DECISIONS.MD UPDATE (if a rule changed)

A rule change is warranted when:
- The fix reveals a gap in the existing methodology
- The fix establishes a new pattern that should be followed going forward
- The fix overrides or refines an existing decision

If a rule changed: read DECISIONS.md, then propose a new entry:

```
## [Decision title]
**Date:** [date]
**Decision:** [what was decided]
**Rationale:** [why — the incident that prompted it]
**Applies to:** [scope — e.g. all SECURITY DEFINER RPCs, App.jsx state setters]
```

If no rule changed: state "No DECISIONS.md update needed."

---

## STEP 4 — CONTEXT.MD UPDATE (if schema or RPCs changed)

If the fix involved:
- A new migration
- A new or modified RPC
- A schema column change

Read the relevant section of CONTEXT.md and propose an update.
Session notes go at the top of the session history section.

Format:
```
### Session [N] — [date]
[Two-sentence summary of what changed and why]
```

If no schema or RPC changed: state "No CONTEXT.md update needed."

---

## STEP 5 — CONFIRM AND WRITE

Present all proposed changes to the developer before writing.
Write each file change only after explicit confirmation.

Do not batch all three files into one confirmation — present them
separately so the developer can approve each independently.

---

## POST-INCIDENT OUTPUT FORMAT

```
POST-INCIDENT: [bug name]

PROPOSED BUGS.MD:
  [exact text to add to resolved section]

PROPOSED DECISIONS.MD:
  [exact entry] / No update needed

PROPOSED CONTEXT.MD:
  [exact session note] / No update needed

Awaiting confirmation to write.
```
