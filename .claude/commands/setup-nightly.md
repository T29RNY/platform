---
description: Build + schedule the 5 nightly automation cloud routines (03:30–04:00 UTC) captured in FEATURES.md.
---

Build and schedule the 5 nightly automation cloud routines captured in FEATURES.md
(the "Nightly automation suite", approved 2026-07-02). All are unattended-safe
(read-only / draft-only) and staggered 03:30–04:00 UTC so they don't collide:

- **A (03:30 UTC)** — `/babysit-prs` read-only PR-triage digest. Skill already exists; schedule only.
- **B (03:40 UTC)** — migration/source drift check. First write `skills/scripts/check-drift.sh`
  (read-only — assert every migration applied to the live DB has matching source on `main`,
  Hard Rule 11), then schedule it.
- **C (03:50 UTC)** — deploy-freshness sweep. Write a read-only check that flags manual-deploy
  apps (venue/hq) sitting on merged-but-unshipped changes and confirms auto-deploy apps are
  current, then schedule it.
- **D (04:00 UTC)** — security/perf advisor sweep. Nightly `get_advisors` (security+performance)
  surfacing only NEW findings vs a stored baseline.
- **E (04:00 UTC)** — `_e2e_` residue leak check wrapping the existing
  `skills/scripts/check-ev-leak.sh` (count of `_e2e_%` rows must be 0).

Rules:
1. **B and C need a script first** — build each as its own gated `dev-loop` PR (branch →
   proof-gate → fresh-context review → PR → **stop at the merge gate**). Do not skip the gates
   just because it's tooling. A and E wrap tools that already exist; D is a prompt-only routine.
2. **Cloud routines, not session loops** — set each up via the `schedule` skill (Skill tool) so
   they survive the laptop being closed. Convert each UTC time to the correct cron expression.
3. **Read-only / draft-only, always** — no routine may merge a PR, apply a migration, deploy, or
   mutate prod. A finding is surfaced/digested only. (`prod-verify` and `qa-loop full` are NOT in
   scope — they need a supervised browser walk and must never be scheduled.)
4. Report each routine's schedule ID once created, and note which of B/C still owe a merge.
