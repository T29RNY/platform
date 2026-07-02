---
name: babysit-prs
description: Read-only open-PR triage sweep for this monorepo. Lists every open PR, reads its CI/deploy status, maps it to its deploying app, classifies merge-readiness (excludes the platform-ref false alarm), flags cloud-session doc-collision risk (two open PRs both touching BUGS.md/RPCS.md/CONTEXT.md/DECISIONS.md), and prints a ranked plain-English digest. NEVER merges, closes, or edits a PR — merge stays a human action. Use when the operator says "babysit prs", "check the open PRs", "what's mergeable", "PR sweep", or wants the open-PR queue triaged. Designed to run via `/loop 30m /babysit-prs` or a daily cloud trigger; pairs with the Nightly QA trigger whose auto-fix PRs this sweep surfaces.
---

# babysit-prs — read-only open-PR triage sweep

A hands-off sweep that answers one question: **which open PRs are ready to merge, and
which are waiting on what?** It reads — it never writes. Run it on a loop or a schedule
to keep the open-PR queue from going stale between work sessions.

## HARD RULE — READ-ONLY, ALWAYS

This skill **NEVER** runs `gh pr merge`, `gh pr close`, `gh pr edit`, `gh pr ready`, or
any other write/mutating `gh` command. It only **reports and recommends**. Merging is a
live production deploy (`apps/inorout` → `platform-clubmanager` → `app.in-or-out.com`),
so the merge tap stays a human decision — every time, no exceptions. If you ever feel
tempted to "just merge the green one", stop: that is out of scope for this skill.

The only commands it runs are read-only and pre-approved in the committed
`.claude/settings.json`:
`gh pr list *`, `gh pr view *`, `gh pr checks *`, `gh pr diff *`,
`bash skills/scripts/check-doc-collisions.sh`.

## The sweep

1. **Enumerate every open PR.**
   ```
   gh pr list --state open --json number,title,headRefName,isDraft,createdAt,author
   ```

2. **For each PR, read its CI / deploy status** with `gh pr checks <n>`, and **map the
   PR to its deploying app** from the branch name / title. The mapping that matters:
   - `apps/inorout` → Vercel project **platform-clubmanager** (the live casual app)
   - `apps/venue` → **platform-venue** · `apps/ref` → **platform-ref**
   - `apps/display` → display · `apps/hq` → hq · etc.
   - docs/config-only branches (`.claude/`, `docs/`, `*.md`) deploy **nothing** — no
     app check is meaningful; treat CI as N/A.
   A PR's merge-readiness is judged on **its own app's** deploy check, not on unrelated
   projects' checks.

3. **Classify each PR into exactly one bucket:**
   - ✅ **MERGE-READY** — own-app deploy check green, not a draft, no failing required check.
   - ⏳ **CI-RUNNING** — checks still pending / in progress.
   - ❌ **CI-FAILING** — a *real* failing check on its **own** app.
     - **EXCLUDE the known false alarm:** `platform-ref` fails on **every** PR
       (pre-existing, unrelated to the change under review). Note it in passing, but
       **never** count it as failing-for-this-PR unless the PR actually touches
       `apps/ref`.
   - 🚧 **DRAFT** — marked draft.
   - 🧟 **STALE** — open > 3 days with no recent activity.

4. **Check cloud-session doc-collision risk** with
   `bash skills/scripts/check-doc-collisions.sh`. Two open PRs that both touch
   `BUGS.md`, `RPCS.md`, `CONTEXT.md`, or `DECISIONS.md` will conflict on merge —
   whichever lands first wins, the second needs manual resolution (the doc-collision
   half of the session-70 duplicate-207 incident; mirrors the migration-number
   collision guard in `check-next-migration.sh`). Exit 1 means the script found one or
   more colliding pairs — carry every reported pair into the digest verbatim.

5. **Print a plain-English digest**, ranked **MERGE-READY first**, one line per PR:
   ```
   #<n> <title> — <bucket> — <app> — <age>
   ```
   If step 4 found any collision risk, add it as its own digest section **above** the
   tally, e.g.:
   ```
   ⚠️ DOC-COLLISION RISK: #101 and #102 both touch RPCS.md — sequence the merge
      (land one, then rebase/resolve the other before merging it).
   ```
   End with a one-line tally:
   ```
   BABYSIT-PRS [date]: N open · N merge-ready · N ci-running · N failing · N draft · N stale · N doc-collision-risk
   ```
   For each MERGE-READY PR, you may add a one-line ship-safety note (e.g. "docs-only,
   DARK-IN-PROD" vs "touches apps/inorout — SHIPS-LIVE, needs proof") so the human can
   merge on a glance — but **do not merge**. If a MERGE-READY PR is also flagged in a
   doc-collision pair, say so on its line (e.g. "MERGE-READY but collides with #102 on
   RPCS.md — merge this one first, then resolve #102") so the operator doesn't merge
   both blind.

6. **Recommend, don't act.** The output is a recommendation the operator reads and acts
   on. The skill's job ends at the digest.

## Running it

- On a loop: `/loop 30m /babysit-prs`
- On a schedule: a daily cloud trigger (see the `schedule` skill).
- It **pairs with the Nightly QA trigger**: that trigger generates auto-fix PRs
  overnight; this sweep is how you find and triage them the next morning without
  hunting through GitHub.
