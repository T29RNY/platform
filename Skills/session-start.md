# SKILL: Session Start
## Fixed opener for every working session

Triggered when: a new session begins, before any task is discussed.
Mode: read-only. No edits.
Exit condition: session brief produced. Developer confirms direction.

---

## PURPOSE

AI sessions have no persistent memory between conversations. Without
a fixed opener, context is rebuilt piecemeal from developer descriptions,
which are incomplete and sometimes stale. This skill runs five deterministic
checks and produces a session brief that answers: what state is the codebase
in, what's broken, what's next, and is there any abandoned work to resume?

---

## STEP 1 — GIT STATE

```
git status
git log --oneline -5
```

Report:
- Any staged or unstaged files (abandoned execute cycle?)
- Last 5 commits with hashes (what was the last thing shipped?)

If staged files are found: immediately flag this. The previous session
may have ended mid-cycle. Read skills/cycle.md — RESUMING AN ABANDONED
CYCLE before proceeding with any new task.

---

## STEP 2 — OPEN BUGS

Read BUGS.md in full.

Report:
- All active bugs, priority ordered
- Any bug that affects the flow being worked on today
- Any workaround that must be remembered during this session

---

## STEP 3 — PHASE STATUS

Read FEATURES.md, the PHASE 2 section only.

Report:
- What is the current phase target date?
- Which Phase 2 features are not yet built?
- Which backlog items are outstanding?

---

## STEP 4 — BUILD STATE

```
bash skills/scripts/check-build.sh
```

Report: PASS or FAIL with any warnings.

A session should never begin on a broken build. If the build fails:
stop, diagnose, fix, commit before starting any new work.

---

## STEP 5 — HYGIENE BASELINE

```
bash skills/scripts/check-hygiene.sh
```

Report: PASS or FAIL per check.

Hygiene failures that pre-exist the session are noted as baseline —
they are not introduced by this session and do not block new work,
but they should be addressed if the relevant file is being touched.

---

## SESSION BRIEF FORMAT

```
SESSION BRIEF — [date]

GIT STATE:
  Last commit: [hash] [message]
  Working tree: clean / [N files modified or staged]
  [If staged: ABANDONED CYCLE — read cycle.md before proceeding]

OPEN BUGS:
  [numbered list from BUGS.md, or "none"]

PHASE STATUS:
  Phase: [current phase, target date]
  Unbuilt: [list, or "none"]
  Backlog: [list, or "none"]

BUILD: PASS / FAIL
HYGIENE: PASS / FAIL [list pre-existing failures if any]

READY: [one sentence — what the session should focus on, or "awaiting direction"]
```

---

## AFTER THE BRIEF

Present the brief. Wait for the developer to confirm the session focus
before starting any audit or execute work.

Do not suggest fixes for pre-existing hygiene failures unless the
developer asks. They are noted for awareness, not action.
