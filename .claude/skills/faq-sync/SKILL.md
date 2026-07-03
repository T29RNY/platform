---
name: faq-sync
description: Keeps apps/inorout's in-app FAQ (apps/inorout/src/data/faq.js, rendered at /faq) in sync with the product. Three jobs each run: (1) new-feature detection — merged PRs/FEATURES.md entries without an FAQ entry get one drafted; (2) accuracy sweep — every existing FAQ entry is checked against the live app (do its linked routes/features still exist, is the copy still true) and drifted entries get fixed; (3) PR-touch sweep — merged PRs since the last run are checked against existing FAQ tags/links and updated if they changed the behaviour described. Use when the operator says "faq sync", "update the FAQ", "check the FAQ", or wants the FAQ page kept current. Designed to run nightly (`/loop 1440m /faq-sync` or a cloud cron routine) — pure content edits to the FAQ data file auto-merge (pre-approved 2026-07-02, see DECISIONS.md); anything touching a route/component still goes through dev-loop's normal PR + human-merge gate.
---

# faq-sync — keep the in-app FAQ current, hands-off

A **thin orchestrator**, same posture as `qa-loop`/`babysit-prs`: it never invents a
second build path. Drafting/editing FAQ content is either (a) a pure content-only edit
to `apps/*/src/data/faq*.js`, which this skill can propose AND merge itself under a
narrow, pre-approved exception, or (b) anything wider (new route, new component, new
app's first FAQ page), which is handed to `dev-loop` exactly like any other change —
full proof gate, review, PR, human merge. This skill never bypasses dev-loop's
guardrails for (b); it only carves out (a).

## Why content-only can auto-merge (read this before touching the gate)

Every other skill in this repo (`dev-loop`, `qa-loop`, `babysit-prs`) holds the line
"never auto-merge" because merging `main` is a live production deploy and the operator
can't technically vet a diff. The operator explicitly carved out ONE exception
(2026-07-02, logged in DECISIONS.md): **a diff that touches nothing but a FAQ content
data file is safe and non-destructive — no DB, no RPC, no auth, no routing, no
component code, nothing that can break or expose anything.** That's the entire scope
of the exception. It is enforced **deterministically**, not by judgment:
`bash skills/scripts/check-faq-content-only.sh <changed files>` must return
CONTENT-ONLY (exit 0). If it doesn't — even a one-line change to `FAQScreen.jsx`, even
a new route — this skill drops back to the normal dev-loop PR + human-merge path. Never
relax this gate; never auto-merge anything the script doesn't clear.

## Content data model (do not drift from this shape)

`apps/<app>/src/data/faq.js` exports `FAQ_ENTRIES`, an array of:
```js
{ id, question, answer, tags: [], links: [{ label, path }] }
```
- `id` — stable kebab-case, never reused for a different question once shipped
  (a stale link elsewhere in the app or a past support conversation may reference it).
- `tags` — lowercase keywords used by job 3 (PR-touch sweep) to match a merged PR's
  changed files/RPCs against existing entries. Keep them concrete (feature/screen
  names), not generic.
- `links[].path` — an in-app route that must actually resolve. Job 2 verifies this.

Today this exists only for `apps/inorout` (`/faq` route, `FAQScreen.jsx`, built
2026-07 — see PR #230). Extending to another app (`apps/venue`, `apps/clubmanager`,
etc.) means building that app's `/faq` route + screen first via `dev-loop` (that's a
component/route change, tier-1 but not content-only) — THEN this skill's content jobs
apply to that app's data file too. Don't invent per-app content until the page exists.

---

## THE THREE JOBS

Run all three every pass; each can produce its own PR (job 1/3 usually add or edit
entries — batch them into ONE content PR per pass, same principle as qa-loop's batched
fix, unless one candidate is ambiguous enough to need its own human decision).

### Job 1 — NEW-FEATURE DETECTION
Find features that shipped without an FAQ entry.
1. Read `FEATURES.md`'s shipped-epic list and `git log --since=<last run> --oneline main`
   for `feat(...)` commits/merged PRs touching `apps/inorout/src/` (the app the FAQ
   currently covers).
2. For each, judge: **is this player/manager-facing and something a user would
   plausibly ask "how does X work?" about?** Skip internal/tooling/admin-only/backend
   changes — the FAQ is for end-user questions, not a changelog.
3. For each genuine candidate, check `FAQ_ENTRIES` for an existing entry covering it
   (match on tags/topic, not just id) — don't duplicate.
4. Draft a new entry: plain-English question a real user would type, a short accurate
   answer (verify the described behaviour against the actual current code — don't
   describe what the PR *title* says, read the diff), and a `links` entry pointing at
   the real in-app route if one exists.

### Job 2 — ACCURACY SWEEP
For every existing entry in `FAQ_ENTRIES`:
1. **Link check** — does each `links[].path` still resolve to a real route in
   `apps/inorout/src/App.jsx`'s `getRoute()`? A renamed/removed route = broken link,
   fix it (repoint or remove the link — never leave a dead link).
2. **Content-drift check** — grep the feature the entry describes (e.g. POTM →
   `POTMVotingModal.jsx`, payment → `packages/core/storage/supabase.js` payment RPCs)
   and confirm the entry's description still matches current behaviour. A renamed
   button, a changed flow (e.g. "tap again to confirm" pattern added), a removed step
   — all count as drift.
3. Fix drifted entries in place. Never delete an entry just because it's slightly
   stale — fix the copy; only remove an entry if the feature itself was fully removed
   (and even then, confirm via `BUGS.md`/`FEATURES.md` that it's genuinely gone, not
   mid-rebuild).

### Job 3 — PR-TOUCH SWEEP
For PRs merged into `main` since the last run:
1. `gh pr list --state merged --json number,title,mergedAt,files --search "merged:>=<last-run-date>"`
   (read-only, same allowlisted pattern as `babysit-prs`).
2. For each merged PR, cross-reference its changed files against every FAQ entry's
   `tags` (e.g. a PR touching `PaymentsScreen.jsx` or a payment RPC → the
   `per-game-payment` entry). A match means that entry's accuracy needs re-checking
   against the new code — fold this into job 2's drift check for that entry rather than
   running two separate passes over the same file.
3. If the PR is genuinely a new user-facing feature with no matching entry, that's
   job 1's job — don't duplicate detection logic, just make sure job 1 also scans this
   PR list (same `git log`/`gh pr list` source, one pass).

---

## THE LOOP

### 1 — GATHER (read-only)
Run all three jobs' read/detection steps above. Produce one worklist: entries to add,
entries to fix, with the evidence (file:line / PR# / route) for each.

### 2 — DRAFT
Write the edits directly into `apps/inorout/src/data/faq.js` (or the relevant app's
data file). This IS the entire diff for a content-only pass — resist the urge to
"also tidy" `FAQScreen.jsx` or add a feature while you're in there; that widens the
diff past the auto-merge boundary and forces the slower path for no reason. If a
genuinely new capability requires a route/component change (e.g. first FAQ page for a
new app), stop this skill's job here and hand off to `/dev-loop <build the FAQ page for
app X>` instead — do not try to shoehorn a route change through this skill.

### 3 — PROVE (cheap, deterministic)
- `bash skills/scripts/check-hygiene.sh apps/inorout/src/data/faq.js`
- `node --check apps/inorout/src/data/faq.js`
- `bash skills/scripts/check-build.sh`
- **`bash skills/scripts/check-faq-content-only.sh` (or pass the changed files
  explicitly)** — this is the gate that decides which path below applies.

### 4a — CONTENT-ONLY PATH (check-faq-content-only.sh = exit 0)
1. Branch (`feat/faq-sync-<date>` or similar), commit, push, open a PR — same
   mechanics as dev-loop step 8, but **skip CI-watch** (docs/content-only, no app
   surface change beyond static data — same reasoning dev-loop already applies to
   `.claude/`/`docs/`/`*.md`-only diffs).
2. One lightweight QA-only reviewer (fresh context): does each new/edited entry read
   as accurate and well-formed against the current app (not just "does the file
   parse")? No security reviewer needed — there is no code/secret/RLS/money surface
   in a pure content diff (state this explicitly, don't skip silently).
3. If the reviewer is clean AND `check-faq-content-only.sh` is exit 0 AND
   `check-live-config.sh` is CLEAR (belt-and-braces — should always be true for a
   pure data file, but never skip the check): **merge it** —
   `gh pr merge <n> --squash --delete-branch`. This is the ONE merge action this
   skill is allowed to take unattended, and only under these three conditions.
4. If the reviewer finds something wrong (inaccurate claim, broken link, malformed
   entry): fix, re-prove, re-review. Same correct-until-green budget as dev-loop
   (~4 passes) — reset and surface rather than thrash.

### 4b — WIDER-DIFF PATH (check-faq-content-only.sh = exit 1)
This should be rare (it means job 1/2/3 concluded the FAQ needs a route/component
change, not just content). Hand off to `/dev-loop <describe the change>` and follow
its normal flow in full — plan gate, proof gate, QA+Security review, PR, **human
merge**. Never merge this path yourself.

### 5 — REPORT
Plain-English chat summary (operator preference, no popups): entries added, entries
fixed (with what was wrong), PRs merged automatically, anything routed to dev-loop and
still awaiting human merge. If nothing needed changing this pass, say so — a silent
clean pass is fine, don't manufacture busywork.

---

## SCHEDULING

Designed for the same nightly cloud-routine window as the rest of the automation
suite (`FEATURES.md`, "Nightly automation suite", 03:30–04:00 UTC) — pick a time in
that window via `CronCreate` that doesn't collide with the others already scheduled.
Also directly invocable any time as `/faq-sync` (e.g. right after shipping a feature,
to draft its entry immediately instead of waiting for the nightly pass).

## GUARDRAILS
- **The ONLY unattended merge this skill may perform** is a `check-faq-content-only.sh`
  CLEAR content diff, reviewed clean, with `check-live-config.sh` also CLEAR. Every
  other diff shape — however small — goes through dev-loop's human-merge gate.
- **Never widen the auto-merge boundary.** Don't add new file patterns to
  `check-faq-content-only.sh` without the operator explicitly re-approving (it's a
  standing exception to a hard rule, not a precedent to extend by inference).
  Cross-reference: `DECISIONS.md` (2026-07-02 entry) is where the operator recorded it.
- **This project only.** Never point at another repo.
- **No fake accuracy.** Job 2's drift check must actually grep/read the current code —
  don't rubber-stamp an entry as accurate because it "sounds plausible."
- **Read-only detection, write-only content.** Jobs 1–3's discovery steps
  (`gh pr list`, `git log`, grep) never mutate anything; only the drafted
  `faq.js` edit is a write, and only that file.
