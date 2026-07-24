# PROD_VERIFY_HANDOFF

> Build with: `/decide PROD_VERIFY_HANDOFF.md` → then `/dev-loop PROD_VERIFY_HANDOFF.md`
> (single tier-1 docs/tooling change — one PR, not an epic).
> Plan gate: batched · Merge mode: per-phase

---

## WHAT IT IS

A new invocable skill — `/prod-verify` — that formalizes the currently-manual
`skills/post-deploy.md` walk (Step 5 of AUDIT→EXECUTE→VERIFY→COMMIT→POST-DEPLOY)
into a **scoped, targeted, self-classifying** post-deploy check.

Today `post-deploy.md` is a prose checklist a human remembers to run after a merge.
It always tells you to walk the same two demo URLs regardless of what changed, and
it has no defined hand-off for a defect it finds. `prod-verify` closes that:

1. **Confirms the merge is actually live** on Vercel before touching anything
   (never walk a stale bundle — `post-deploy.md` STEP 1).
2. **Derives which surfaces to walk from what actually changed** — reads the merged
   PR's diff, maps changed files → app(s) → the specific live routes to walk (the
   same file→app map `babysit-prs` already uses). So it tests the changed flow +
   its adjacent screens, **not everything**.
3. **Runs a supervised Playwright-MCP walk of the relevant live surface(s)** as the
   **demo player token + demo admin only** — the exact surfaces `post-deploy.md`
   already sanctions on live (`in-or-out.com/p/p_demotoken_01`, `/demoadmin`).
   Captures console errors, network 4xx/5xx, white-screens, and broken flows.
4. **For RPC/schema changes**, carries forward `post-deploy.md` STEP 3's live-DB
   read checks (`check-rpc-security.sh` / `check-db-schema.sh` + a read-only
   spot-query via Supabase MCP).
5. **Classifies every failure into T1 or T3** (the operator's two-bucket model):
   - **T1 — live functional defect** → opens a **`/dev-loop` defect-fix phase**
     (which re-enters every dev-loop guardrail; the fix then re-deploys and
     re-runs `/prod-verify` → closed loop).
   - **T3 — design / gate / tier-3 decision** → **surfaced to the operator** in
     plain English, never auto-acted.
6. **Is also invokable manually** with an explicit app/surface list when no phase
   is in scope (`/prod-verify apps/venue bookings`).

It is a **thin orchestrator** in the exact mould of `qa-loop` and `babysit-prs`:
it reuses `post-deploy.md`'s live checks, `babysit-prs`'s app-map, `qa-loop`'s
Playwright-MCP walk + T-triage pattern + `DEMO_USERS.md`, and `dev-loop` for the
T1 fix. It adds **no** new services, tables, report systems, or merge power.

**The core reconciliation (the one real design tension):** every sibling skill
forbids "any hands-on walk against production." `prod-verify`'s whole job is to
walk production — so it inherits `post-deploy.md`'s **narrow, already-sanctioned
exception**: live prod, **demo surfaces only, read-mostly, supervised (operator
present post-merge), NEVER a real team, NEVER scheduled-unattended.** That
boundary is a hard guardrail in the skill, not a footnote.

---

## LOCKED DECISIONS

These are the assumptions carried into the build. Confirm any you disagree with at
the plan gate; otherwise they stand.

1. **Two-bucket triage (T1 / T3), not qa-loop's three.** The operator's brief is
   explicit: a defect that reached *production* is always worth a real fix cycle,
   so there is no "T2 polish auto-fix" tier here — any live functional defect is
   **T1 → a fresh `/dev-loop` fix phase**. dev-loop's own T1/T2 granularity still
   applies *inside* that fix cycle. Subjective/gated → **T3 → surface**.

2. **prod-verify NEVER fixes in-place.** Unlike qa-loop (which batches CLEAR fixes
   itself via dev-loop mid-run), a prod defect fix is a whole new change that must
   go branch→proof-gate→review→PR→merge→deploy. So prod-verify's T1 action is to
   **launch/queue a `/dev-loop <defect>` phase**, not to edit anything. prod-verify
   stays as read-only as `babysit-prs`.

3. **Live prod, demo surfaces only, supervised.** Walks `in-or-out.com` demo
   player + demo admin (and the equivalent demo surface for `apps/venue` /
   `apps/ref` / etc.). **Never a real team** (Hard Rule 6 — demo is invalid for
   auth/RLS *correctness* proof, but valid and safe for a "did the bundle deploy &
   render" prod smoke). **Never scheduled unattended against prod** (breaks the
   qa-loop/dev-loop guardrail). Operator is present because it runs right after
   they tapped merge at the dev-loop merge gate.

4. **It confirms deploy-live BEFORE walking.** Uses `gh pr checks <PR#>` / the
   merge-commit Vercel status to confirm the own-app deploy is **Ready**, and
   accounts for the known "updates land on close+reopen / Vercel MCP is stale"
   caveat (MEMORY: inorout deploy note). If still building → wait, never walk a
   stale bundle. `platform-ref` is the known false-alarm and is excluded.

5. **Surface derivation = deterministic file→app→route map.** Reuse
   `babysit-prs`'s mapping (`apps/inorout`→platform-clubmanager /
   `in-or-out.com`; `apps/venue`→platform-venue; `apps/ref`→platform-ref;
   `apps/display`/`hq`/etc.). Changed components → the screens that render them →
   the walk list. Docs/config-only diffs (`.claude/`/`docs/`/`*.md`) deploy
   nothing → prod-verify reports **"nothing to walk — no app deployed"** and exits
   clean (mirrors babysit-prs's N/A rule).

6. **Schema-cache flush stays gated, not auto-run.** `post-deploy.md` STEP 4's
   `pg_notify('pgrst','reload schema')` is a live-DB write via `execute_sql`, which
   is *deliberately not allowlisted* (dev-loop operating posture). prod-verify
   **recommends** the flush with the one-line command if it sees a 404-on-existing-
   RPC symptom; the operator runs it. Read-only Supabase MCP checks (STEP 3) stay
   in-skill (allowlisted).

7. **`post-deploy.md` becomes the skill's reference, not a duplicate.** The prose
   checklist in `skills/post-deploy.md` is updated to point at `/prod-verify` as
   its executable form (thin-orchestrator / reuse principle — no parallel copy of
   the same steps). dev-loop's Step 8/9 post-merge note recommends `/prod-verify
   <PR#>` as the formal POST-DEPLOY action.

8. **Invocation surface** (mirrors qa-loop):
   - `/prod-verify` — auto-find the most-recently-merged PR to `main`, derive
     surfaces from its diff, walk.
   - `/prod-verify <PR#>` — verify a specific merged PR.
   - `/prod-verify <app/area>` — explicit manual surface list (no phase in scope).
   - Free text narrows the walk to that area.

---

## KEY AUDIT FACTS (load-bearing — do not re-derive)

- **Next free migration = 459.** **This feature needs ZERO migrations** — it is a
  skill markdown file + light doc wiring. No DB, no RLS, no RPC, no money, no auth.
- **Tier = 1 throughout. `check-live-config` = CLEAR / DARK-IN-PROD.** Every file
  touched is `.claude/` / `skills/` / root `*.md` — dev-tooling, **not in any app
  bundle**. Nothing ships to the live casual team or the App-Store Capacitor bundle.
- **Sibling skills to mirror (already read):**
  - `.claude/skills/qa-loop/SKILL.md` — the closest template: scope→baseline→walk→
    triage→(fix via dev-loop)→re-test→surface T3. prod-verify = its post-merge,
    prod-facing twin.
  - `.claude/skills/babysit-prs/SKILL.md` — the read-only, thin, app-map digest
    style + the exact file→app mapping + the `platform-ref` false-alarm exclusion.
  - `.claude/skills/dev-loop/SKILL.md` — Step 8/9 (PR/merge gate) is where
    prod-verify plugs in as the formal Step 5 POST-DEPLOY; also the source of the
    "never walk prod unattended", allowlist-hygiene, and tier/ship-safety rules.
  - `skills/post-deploy.md` — the prose being formalized (STEP 1 confirm-deploy,
    STEP 2 live UI, STEP 3 live-DB reads, STEP 4 cache flush, output format).
- **Reusable, no new scripts strictly required.** The file→app→surface map can live
  in the skill prose (as babysit-prs does). **Optional deterministic helper**
  `skills/scripts/check-changed-surfaces.sh` (diff → app list) is a nice-to-have,
  NOT required for v1 — note it as a future extension, keep v1 thin.
- **Playwright MCP is available this session** (browser_* tools loaded). `DEMO_USERS.md`
  + the localhost-admin-backdoor note (`127.0.0.1` for true-unauth) govern the walk
  identities.
- **Registration:** the new skill must be listed in `CLAUDE.md`'s Skills-directory
  section alongside qa-loop / babysit-prs / dev-loop (Hard Rule 8 — keep the index
  current).

---

## ROADMAP — PRs in dependency order

Single logical unit; can ship as **one PR**. Split shown for reviewer clarity — if
built in one dev-loop pass, keep it one PR with both files.

### PR #1 — Author the `/prod-verify` skill + wire it into the cycle · TIER-1 · CLEAR / DARK-IN-PROD

**What:**
- Create `.claude/skills/prod-verify/SKILL.md` with frontmatter (`name`,
  `description` following the qa-loop/babysit-prs pattern) and the body:
  confirm-deploy → derive-surfaces-from-diff → supervised demo-only Playwright-MCP
  live walk → (RPC/schema? read-only live-DB checks) → **T1/T3 triage** → T1 opens
  `/dev-loop <defect>`, T3 surfaces in plain English → findings land in `BUGS.md` /
  `GO_LIVE_ISSUES.md` (reuse existing ledgers, no new report system) → invocation
  section.
- Bake in the **hard guardrails**: demo surfaces only, read-mostly, supervised,
  never a real team, never scheduled-unattended-against-prod, never merges/edits,
  schema-cache flush is recommend-only, `platform-ref` excluded.
- Update `skills/post-deploy.md` to reference `/prod-verify` as its executable
  form (no duplicated steps).
- Add a one-line recommendation in `.claude/skills/dev-loop/SKILL.md` Step 8/9 that
  the formal POST-DEPLOY action after a merge is `/prod-verify <PR#>`.
- Register `/prod-verify` in `CLAUDE.md`'s Skills-directory list.

Gates: node --check N/A (no JS) · check-hygiene N/A (docs) ·
`bash skills/scripts/check-live-config.sh` must return **CLEAR** · one combined
QA-correctness reviewer (docs-only → security reviewer = N/A, no code surface per
dev-loop's proportionality rule) · optional: dry-run `/prod-verify <a recent merged
PR#>` end-to-end as the real smoke.

**Done-check:** `/prod-verify` appears in the available-skills list; invoking it on
a recently-merged PR confirms deploy-live, walks only the surfaces that PR's diff
implicates, and prints a T1/T3 digest; a docs-only PR yields "nothing to walk".

---

## 🚦 GATES the loop must stop at

- **Plan gate** — batched, one approval for the single change (tier-1, CLEAR, so a
  post-and-proceed is defensible, but confirm the two-bucket T1/T3 decision and the
  live-prod-demo-only boundary first).
- **Merge gate** — human tap, as always (`/dev-loop` stops here per the operator's
  instruction). Ship-safety verdict expected: **DARK-IN-PROD — dev-tooling only,
  not in any app bundle.**
- **No tier-3 in this build** — no migration, RLS, money, auth, or outward surface
  is touched. (The *skill it creates* walks prod, but the skill file itself ships
  nothing to prod.)

---

## DONE =

- `.claude/skills/prod-verify/SKILL.md` exists, is registered in `CLAUDE.md`, and is
  invokable.
- It derives its walk targets from the merged diff (not a fixed URL list), runs a
  supervised demo-only live walk, and classifies findings T1 (→ dev-loop) / T3
  (→ surface).
- `skills/post-deploy.md` + `dev-loop` Step 8/9 reference it; no duplicated
  checklist.
- Guardrails are explicit in the skill: demo-only, supervised, never-unattended-prod,
  read-only, no self-merge.
- PR merged (DARK-IN-PROD verdict), and — the honest end-to-end proof — a real
  `/prod-verify <PR#>` dry-run behaves as specified.

---

## Related

- Formalizes `skills/post-deploy.md`.
- Twin of `.claude/skills/qa-loop/SKILL.md` (pre-merge branch QA) — prod-verify is
  the post-merge, prod-facing half.
- Reuses `.claude/skills/babysit-prs/SKILL.md`'s file→app map + `platform-ref`
  false-alarm exclusion.
- Plugs into `.claude/skills/dev-loop/SKILL.md` Step 8/9 as the formal Step 5
  POST-DEPLOY.
- Governed by MEMORY: inorout deploy note (Vercel-stale / close-reopen), native-app-
  only, localhost-admin-backdoor, DEMO_USERS.md.
