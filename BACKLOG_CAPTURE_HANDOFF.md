# BACKLOG-CAPTURE — build manifest

> **🏁 DONE — 2026-07-01.** PR 1/2 `/backlog-capture` skill → **#199 merged**;
> PR 2/2 `/qa-loop` T3 auto-file + `--from qa-loop` mode → **#200 merged**. Both
> TIER-1 · DARK-IN-PROD, no migration consumed. Plan-gate decisions A (dedicated
> `## 📥 CAPTURED` inbox) + B (security/compliance as BUGS.md tags) both confirmed.

**Trigger (paste-ready):**
`/loop /dev-loop BACKLOG_CAPTURE_HANDOFF.md`

Plan gate: batched · Merge mode: per-phase

---

## WHAT IT IS

A new invocable skill, `/backlog-capture`, that turns loose input into well-formed,
filed backlog entries — so ideas and findings stop dying in chat scrollback.

It ingests three input shapes:
- a **raw idea** (freeform text),
- a **GitHub issue URL** (`github.com/T29RNY/platform/issues/<n>` → fetched via `gh issue view`),
- a **freeform bullet list** (many items at once, classified independently).

For each item it: **classifies** it (feature · bug · security · compliance), assigns a
**rough effort** (XS / S / M / L / XL), attaches a **source link**, and **appends** it to
the correct doc — `FEATURES.md` (features), `BUGS.md` (bugs / security / compliance),
`GO_LIVE_ISSUES.md` (pre-launch production items). It **does not rank or score** — that's
`/backlog`'s job. `/backlog-capture` fills the inbox; `/backlog` picks from it.

Second job: it is **callable at the end of `/qa-loop`** (`/backlog-capture --from qa-loop …`)
to auto-file the T3 findings that currently only surface in chat and rely on the operator
remembering to log them. That closes a real gap — qa-loop step 6 *says* T3s "land in
BUGS.md / GO_LIVE_ISSUES.md" but nothing automates it today.

**Target users:** the founder (fast capture from the laptop/phone) and the agent fleet
(qa-loop, and any future producer of findings).

**Why it's small:** it is a Markdown skill + allowlist entries + one wiring line in
qa-loop + a registration line in CLAUDE.md. **No app code, no DB, no migration, no RLS,
no money, no auth.** Every PR is TIER-1 · ship-safety CLEAR.

---

## LOCKED DECISIONS

Decisions the operator gave in the brief are marked **[given]**; the rest are proposed and
should be confirmed at review.

1. **[given]** `/backlog-capture` files, it does **not** rank. Ranking stays in `/backlog`.
2. **[given]** Three inputs: raw idea, GitHub issue URL, freeform bullet list.
3. **[given]** Classify each item feature / bug / security / compliance; assign XS–XL effort;
   add a source link.
4. **[given]** Callable at the end of `/qa-loop` to auto-file T3 findings.
5. **Captures are LIGHTWEIGHT, not narrative.** Today's `BUGS.md` / `FEATURES.md` entries are
   rich multi-paragraph blocks keyed to a **shipped/fixed session** (`## SESSION N — ✅ …`).
   A raw, *unbuilt* idea must **not** masquerade as one — it would fake a session number and
   pollute the shipped log. `/backlog-capture` writes a compact one-block **captured/open**
   entry instead (date · classification · effort · source · one-line body). **Proposed: a
   dedicated `## 📥 CAPTURED — triage inbox (unbuilt)` section** near the top of each target
   doc that captures append into and `/backlog` reads, keeping the shipped narrative log
   clean. Confirm at review: dedicated inbox section (recommended) vs. inline compact entries.
6. **Classification → doc routing** (from how items are actually filed today):
   - feature / new capability → **FEATURES.md**
   - bug / tech-debt / defect in shipped code → **BUGS.md**
   - **security** (auth · RLS · SECURITY DEFINER · token flow) → **BUGS.md**, `⚠️ SECURITY` tag
   - **compliance** (under-18 · consent · UK-GDPR · health data · App-Store) → **BUGS.md**,
     `📋 COMPLIANCE` tag
   - production incident needing a device/pre-flight recheck before onboarding → **GO_LIVE_ISSUES.md**
   Security and compliance are **tags on a BUGS.md entry**, not separate files — that matches
   the repo (there is no separate security tracker). Confirm at review.
7. **Effort taxonomy is NET-NEW** (XS/S/M/L/XL appears nowhere today; the repo uses TIER-1/2/3
   for *risk*, which is orthogonal). Rubric: **XS** = one-liner / copy / flag; **S** = one RPC
   or component, no migration; **M** = schema add + a few RPCs, 1 migration; **L** = multi-RPC /
   multi-screen, 2–3 migrations; **XL** = epic / cross-app / native / compliance audit. Effort is
   advisory only (capture ≠ commitment); operator/`/backlog` can override.
8. **Dedup before append.** Grep the target doc (case-insensitive) for a short title keyphrase;
   on a hit, **skip and report the existing line**, don't double-file. Cheap, no DB.
9. **Append-only, never destructive.** Bump the `*Last updated: …*` line on FEATURES.md /
   BUGS.md; **never** touch the GO_LIVE_ISSUES.md preamble (lines 1–36). One Write per doc.
10. **Read-mostly + allowlist-safe** like every skill here: Read/Grep/Glob + `gh issue view` +
    the target-doc Writes. No piped/compound Bash in the skill body; no live-DB access.

---

## KEY AUDIT FACTS

Load-bearing facts confirmed during scope — do not re-derive.

- **Next free migration = 459** (highest applied = 458). **This epic needs none** — it stays 459.
- **Skills live at** `.claude/skills/<name>/SKILL.md`. New skill dir: `.claude/skills/backlog-capture/`.
- **GitHub remote** = `https://github.com/T29RNY/platform.git` → owner/repo `T29RNY/platform`.
  `gh` CLI is already used across skills (dev-loop, babysit-prs, prod-verify); ingest via
  `gh issue view <n> --json title,body,labels --repo T29RNY/platform`.
- **Ecosystem wiring:** `/backlog-capture` = **producer**; `/backlog` = **consumer** (reads
  FEATURES.md/BUGS.md/epics, never writes). `/decide` reads a `*_HANDOFF.md` and updates
  DECISIONS.md + FEATURES.md *status* — **no overlap**: decide processes fully-scoped
  deliverables; backlog-capture files raw inbox rows.
- **qa-loop attach point:** qa-loop `SKILL.md` step **6 — SURFACE T3**. Its text already says
  "Still-open + T3 items → BUGS.md; production-class → GO_LIVE_ISSUES.md" but **no call
  automates it** — that's the gap. Wire the call *after* the operator sees the T3 summary
  (capture the findings, don't change qa-loop's human-gated triage).
- **Doc shapes** (match byte-faithfully): FEATURES.md — newest at top under a `*Last updated*`
  line, `---`-separated; BUGS.md — `## SESSION N — …` descending under a `*Last updated*`
  line; GO_LIVE_ISSUES.md — numbered `## N. DOMAIN — …`, `---`-separated, **static preamble
  lines 1–36 never modified**. Captured/open entries use the new lightweight inbox shape
  (decision #5), *not* these shipped-narrative shapes.
- **No hook blocks .md writes:** `post-edit-hygiene.sh` exits 0 for non-`.js/.jsx/.ts/.tsx`
  files. But the three target docs are **not yet in the `Write(...)` allowlist** — PR #1 adds
  `Write(.../FEATURES.md)`, `Write(.../BUGS.md)`, `Write(.../GO_LIVE_ISSUES.md)` to
  `.claude/settings.json` (else the skill prompts every run and can't run unmanned).
- **Git casing gotcha — RESOLVED:** PR #580 committed several script/state files under
  capital-S `Skills/` instead of `skills/`; invisible on macOS (case-insensitive APFS) but
  broke every lowercase reference (`check-hygiene.sh` check 8, the drift/deploy-freshness/
  advisor-sweep nightly routines) on case-sensitive Linux — where CI, cron routines, and this
  cloud session actually run. Fixed via nightly-QA auto-fix: all four files `git mv`'d to
  `skills/scripts/` + `skills/state/`, `check-advisors.sh`'s internal self-references corrected.
  Everything now tracks under lowercase `skills/` only — no more dual casing to avoid.
- **No prior artefact** — no existing `*_HANDOFF.md`, epic doc, or FEATURES.md row for this;
  scoped fresh.

---

## ROADMAP — PRs in dependency order

### PR #1 — the `/backlog-capture` skill (core)
**TIER-1 · ship-safety CLEAR · no migration.**
Author `.claude/skills/backlog-capture/SKILL.md` in the house style (front-matter `name` +
`description` with trigger phrases; cite `loop-principles.md` by L-number, don't restate
methodology; "runs allowlist-safe" + "Hard guardrails" + "Token discipline" sections).
Encodes: the 3 input parsers (raw / GitHub URL via `gh issue view` / bullet list), the
classify rubric (feature/bug/security/compliance), the XS–XL effort rubric, the routing table
(decision #6), the dedup grep-before-append (decision #8), and the lightweight captured-entry
shape into the `## 📥 CAPTURED` inbox section (decision #5). Add the three `Write(...)`
allowlist lines to `.claude/settings.json`. Register the skill in `CLAUDE.md` (Skills
directory list) beside `/backlog`.
Gates: node --check n/a (no JS) · manifest/skill lint · a dry-run capture of one raw idea +
one GitHub URL + a 3-item bullet list each land a correctly-classified, correctly-routed,
deduped entry in the right doc's inbox section · a re-run of the same input is detected as a
duplicate and skipped · build stays green · PR merged (source on main).
**Done-check:** `/backlog-capture "add a mute-notifications toggle"` files one FEATURES.md
inbox row (feature · XS/S · source `input:<ts>`); a security-flavoured idea routes to BUGS.md
with `⚠️ SECURITY`; a duplicate second run is skipped with the existing line reported.

### PR #2 — wire the `/qa-loop` T3 auto-file
**TIER-1 · ship-safety CLEAR · no migration. Depends on PR #1.**
In `.claude/skills/qa-loop/SKILL.md` step 6 (SURFACE T3), add one line: after the operator
sees the T3 summary, call `/backlog-capture --from qa-loop <T3 findings>` to file the
still-open T3 items into BUGS.md / GO_LIVE_ISSUES.md automatically. Teach `/backlog-capture`
the `--from qa-loop` mode (parse the T3 summary shape: intent question + ship-safety verdict +
draft) so captured rows carry the qa-loop provenance as their source link. **Do not** change
qa-loop's human-gated triage or its auto-fix batching — capture is additive, post-decision.
Gates: a simulated end-of-qa-loop T3 summary is parsed and filed to the correct docs with
`source: qa-loop <run-ref>` · qa-loop's existing flow is unchanged (no new merge power, no
auto-fix behaviour touched) · dedup still holds so a re-surfaced T3 isn't double-filed · build
green · PR merged.
**Done-check:** feeding a two-item T3 summary (one still-open bug, one go-live pre-flight)
files exactly two inbox rows — the bug to BUGS.md, the pre-flight to GO_LIVE_ISSUES.md — each
tagged `--from qa-loop`; re-feeding the same summary files nothing new.

---

## 🚦 GATES the loop must stop at

- **None are tier-3.** Both PRs are TIER-1 · CLEAR (docs + skill files only; no DB/RLS/money/
  auth/native). No migration-apply gate, no deploy gate.
- **Plan gate (batched):** confirm the two open product decisions before PR #1 executes —
  (a) dedicated `## 📥 CAPTURED` inbox section vs. inline compact entries (decision #5); and
  (b) security/compliance as **tags on BUGS.md** vs. a different destination (decision #6).
- **Merge gate (per-phase):** each PR is a normal human merge tap — the only stop per PR.
  Nothing here auto-merges.
- **Guardrail to enforce in review:** the skill must stay allowlist-safe (no piped/compound
  Bash, no live-DB) or it will freeze an unmanned qa-loop call.

---

## DONE

`/backlog-capture` exists and is registered in CLAUDE.md; it ingests a raw idea, a GitHub
issue URL, and a bullet list; classifies each feature/bug/security/compliance; assigns XS–XL;
routes to FEATURES.md / BUGS.md / GO_LIVE_ISSUES.md in the lightweight captured shape; dedups
before appending; adds a source link; never ranks. `/qa-loop` step 6 calls it to auto-file T3
findings with qa-loop provenance, with qa-loop's own triage unchanged. Both PRs merged to main,
builds green, no migration consumed (stays 459).

---

## Related

- Consumer: `.claude/skills/backlog/SKILL.md` (`/backlog` reads the inbox this fills).
- Producer hook: `.claude/skills/qa-loop/SKILL.md` step 6 (T3 surface → auto-file).
- Sibling: `.claude/skills/decide/SKILL.md` (processes scoped handoffs; no overlap).
- Docs filed into: `FEATURES.md`, `BUGS.md`, `GO_LIVE_ISSUES.md`.
- House rules: `CLAUDE.md` Hard Rule 8 (BUGS/FEATURES/DECISIONS kept current);
  `.claude/skills/dev-loop/loop-principles.md` (L-numbers).
