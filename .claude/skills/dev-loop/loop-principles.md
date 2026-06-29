# Dev-loop principles

These are the load-bearing principles behind the dev-loop. They are pasted
verbatim and do not change per task. The loop (SKILL.md) is one concrete
implementation of them for this repo.

L1  Close the verification loop or you become it. A loop needs a pass/fail check it
    runs itself; self-verification is what lets it run unattended.
L2  Verify with the strongest signal: deterministic rules > visual/render > LLM judge.
L3  Demand evidence (command + output/exit code), not a claim of "done".
L4  The worker is not the grader — review in fresh context that sees only the diff +
    criteria; scope it to real gaps (graders over-report).
L5  Verify end-to-end, as a user — "can the thing actually run?" Shallow unit-green
    with a broken feature is the classic miss.
L6  One increment per cycle. Never one-shot — over-ambition that runs out of context
    mid-task is the #1 long-horizon failure.
L7  Externalise state to files (progress/manifest + git) so a fresh context resumes;
    durable rules live in CLAUDE.md (they survive compaction; prompts don't).
L8  Context is finite and decays (context rot). Curate the smallest high-signal set;
    compact, take notes, use sub-agents with clean windows; reset on thrash.
L9  Bound every loop with explicit stop conditions + human checkpoints for the
    irreversible/outward.
L10 Separate explore/plan from execute — don't solve the wrong problem.
L11 Parallelism in isolated worktrees is the default at scale.
L12 Don't loop what doesn't need a loop — simplest thing first; a loop only earns its
    place when flexibility is needed AND a real success signal exists.

Anti-patterns to design against: one-shotting; premature "done"; shallow testing;
correcting-over-and-over into a polluted context; kitchen-sink sessions; bloated
CLAUDE.md; framework abstraction that hides the loop; the worker grading itself.

Checklist for any new loop: (1) what pass/fail check does it run itself? (2) is it
deterministic + does it show evidence? (3) who's the independent grader? (4) does it
verify end-to-end? (5) what's one increment? (6) where does state live? (7) iteration
cap + reset-on-thrash? (8) human stop conditions? (9) can stages run isolated/parallel?
(10) does it even need a loop?
