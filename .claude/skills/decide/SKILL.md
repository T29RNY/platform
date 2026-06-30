# /decide — scope-to-build bridge

Triggered by: `/decide <HANDOFF_FILE>` or `/decide` (auto-finds most recent
`*_HANDOFF.md` in the repo root when no file is named).

This skill sits between `/scope` (which produces a HANDOFF.md) and `/dev-loop`
(which builds it). It reads the handoff, updates the canonical docs, and offers
to launch the build — but never launches automatically.

---

## STEP 1 — FIND AND READ THE HANDOFF

If a file path was provided: read it directly.

If no file was provided:
```
ls /Users/tarny/platform/*_HANDOFF.md -t | head -1
```
Read the most recently modified HANDOFF.md in the repo root.

Read the file in full. Extract:
- **Feature name** — from the epic title line
- **Architectural decisions** — rationale sections, any "why not X" notes
- **Phase list** — all phases with their migration numbers (if any)
- **Tier classification** — highest tier touched (1 = frontend, 2 = schema,
  3 = auth/money/outward)
- **Dependencies** — anything that must be true before this can ship

---

## STEP 2 — EXTRACT KEY DECISIONS

Read the HANDOFF.md for decision points. These are typically:
- Architecture choices made (and alternatives rejected)
- Schema decisions (new table vs extending existing)
- Tier classification rationale
- Known risks or constraints

List them. You'll use this in the DECISIONS.md update.

---

## STEP 3 — UPDATE DECISIONS.md

Read the current tail of DECISIONS.md to find the right insertion point
(usually append to the end).

Append a new dated entry:

```markdown
## [YYYY-MM-DD] — [Feature name]
[2-3 sentences: what was decided, why, what alternatives were rejected]
Handoff: [HANDOFF_FILE]
```

Write only what was actually decided in the handoff. Do not invent rationale.

---

## STEP 4 — UPDATE FEATURES.md

Read FEATURES.md to find the feature (search by name or related phase).

If found: update its status line to include `scoped / ready to build` with
today's date and a reference to the HANDOFF.md.

If not found: add a new entry in the appropriate phase section with:
- Feature name
- Status: `scoped / ready to build ([date])`
- Reference: `Handoff: [HANDOFF_FILE]`

---

## STEP 5 — REPORT

Print a summary:
```
/decide complete for: [Feature name]

DECISIONS.md: appended entry dated [date]
FEATURES.md:  [updated existing entry at line N] OR [added new entry in phase X]

Phases: [N] total — [N tier-1] [N tier-2] [N tier-3]
Migrations: [list NNN numbers if any, or "none"]
Highest tier: [1|2|3] — [what that means: safe dark-ship | schema | auth/money/outward]
```

---

## STEP 6 — OFFER TO LAUNCH

Say exactly:

```
Ready to launch. Options:
  "proceed"  → run /dev-loop on P1 of this manifest (single phase, then stops)
  "loop"     → run the full epic unattended via /loop /dev-loop [HANDOFF_FILE]

Which would you like?
```

Then STOP. Do not call dev-loop, do not read the manifest further, do not
stage or commit anything. Wait for the operator to say "proceed" or "loop"
before doing anything more.

---

## HARD RULES

- Never auto-launch dev-loop — always wait for explicit confirmation.
- Never close or modify bugs without developer confirmation.
- Read-only until STEP 3/4 (DECISIONS.md + FEATURES.md writes). No other files.
- If the HANDOFF.md has no clear decision rationale, say so rather than inventing it.
- If the feature is already marked "scoped" in FEATURES.md, note it and ask whether
  to overwrite or skip the FEATURES.md update.
