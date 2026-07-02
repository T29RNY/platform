# Epic manifest — /babysit-prs skill (2 phases)
- Epic: Build a read-only open-PR triage sweep skill, runnable via /loop or a schedule
- Plan gate: batched
- Merge mode: auto
- Approved: 2026-06-30

---

## Context

Two self-contained tier-1 phases. No migrations, no RLS, no auth, no app code.
Both are docs/config only (`.claude/settings.json`, `.claude/skills/`, `CLAUDE.md`) —
`check-live-config` returns CLEAR for both, so both are AUTO-MERGEABLE under `Merge mode: auto`.

The skill being built is **read-only**: it lists open PRs, reads their CI status, classifies
merge-readiness, and prints a digest. It NEVER merges, closes, or edits a PR — merge stays a
human action. That keeps `/babysit-prs` itself tier-1/2 and safe to run on a loop or schedule.

Runtime commands the built skill uses (`gh pr list/view/checks/diff`) are already auto-approved
in `settings.local.json`; P1 also adds the read-only ones to the COMMITTED `.claude/settings.json`
so the skill runs hands-off in cloud / scheduled sessions too (which only inherit committed approves).

---

## Phases   (status: pending | in-progress | done | blocked: <why> | needs-human: <what>)

### P1 — settings.json: commit read-only gh-PR approves
- status: done
- deps: none
- goal: Add these read-only entries to the `permissions.allow` array in the COMMITTED
  `.claude/settings.json` (so every session — desktop, cloud, scheduled — can run the
  babysit-prs sweep without a permission prompt). Do NOT add any write/merge entry here:
  - `"Bash(gh pr list *)"`
  - `"Bash(gh pr view *)"`
  - `"Bash(gh pr checks *)"`
  - `"Bash(gh pr diff *)"`
  Append only; do not remove or reorder existing entries.
- tier-3 touch: none
- proof: grep `.claude/settings.json` confirms the 4 entries present; check-build.sh passes
- PR: #190 (MERGED — squash, CLEAR, QA CLEAN)

### P2 — .claude/skills/babysit-prs/SKILL.md + register in CLAUDE.md
- status: done
- deps: none
- goal:
  PART A — Create `.claude/skills/babysit-prs/SKILL.md`, a slash-command skill. Frontmatter:
  `name: babysit-prs`, a description matching the loop/skills style (read-only open-PR triage
  sweep; surface merge-readiness; never merges). Body specifies the sweep:

  1. `gh pr list --state open --json number,title,headRefName,isDraft,createdAt,author` —
     enumerate every open PR.
  2. For each PR: read CI via `gh pr checks <n>` and map the PR to its deploying app
     (e.g. apps/inorout → platform-clubmanager) from the branch/title.
  3. Classify each PR into exactly one bucket:
     - ✅ MERGE-READY — own-app deploy check green, not draft, no failing required check
     - ⏳ CI-RUNNING — checks still pending
     - ❌ CI-FAILING — a real failing check on its own app
       (EXCLUDE the known false alarm: `platform-ref` fails on EVERY PR — note it, never
        count it as failing-for-this-PR)
     - 🚧 DRAFT — marked draft
     - 🧟 STALE — open > 3 days with no recent activity
  4. Print a plain-English digest, ranked MERGE-READY first, one line per PR:
     `#<n> <title> — <bucket> — <app> — <age>`. End with a one-line tally:
     `BABYSIT-PRS [date]: N open · N merge-ready · N ci-running · N failing · N draft · N stale`.
  5. HARD RULE in the skill body: this skill is READ-ONLY. It NEVER runs `gh pr merge`,
     `gh pr close`, `gh pr edit`, or any write. It only reports and recommends. Merging stays
     a human decision (merge = live prod deploy).
  6. Note it is designed to run via `/loop 30m /babysit-prs` or a daily cloud trigger, and
     pairs with the Nightly QA trigger (which generates auto-fix PRs this sweep then surfaces).

  PART B — Add one line to `CLAUDE.md` under the "Skills directory" section, after the
  `/decide` entry:
  `- '.claude/skills/babysit-prs/SKILL.md' — read-only open-PR triage sweep. Lists open PRs,
    reads CI, classifies merge-readiness (excludes the platform-ref false alarm), prints a
    ranked digest. Never merges. Run via /loop or a schedule.`
- tier-3 touch: none
- proof: file exists at `.claude/skills/babysit-prs/SKILL.md`; CLAUDE.md references it;
  check-build.sh passes; check-hygiene.sh N/A (no .js); check-live-config.sh CLEAR
- PR: #191 (MERGED — squash, CLEAR, QA CLEAN)

## Log
<!-- one line per phase outcome: date · phase · result · PR# -->
- 2026-06-30 · P1 · DONE — read-only gh-PR approves committed to .claude/settings.json; CLEAR, build PASS, QA CLEAN · PR #190 (merged)
- 2026-06-30 · P2 · DONE — /babysit-prs read-only triage skill + CLAUDE.md register; CLEAR, build PASS, QA CLEAN · PR #191 (merged)
- 2026-06-30 · EPIC COMPLETE — both phases shipped & merged.
