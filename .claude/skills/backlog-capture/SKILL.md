---
name: backlog-capture
description: Turns loose input into well-formed, filed backlog entries so ideas and findings stop dying in chat scrollback. Ingests a raw idea, a GitHub issue URL, or a freeform bullet list; classifies each item feature/bug/security/compliance; assigns a rough XS–XL effort; adds a source link; dedups; and appends a compact captured row to the right doc's triage inbox (FEATURES.md / BUGS.md / GO_LIVE_ISSUES.md). Use when the operator says "capture this", "backlog this", "log this idea", "file these", "add to the backlog", or pastes an issue URL / bullet list to file. It FILES, it does not rank — ranking stays in `/backlog`. Also callable at the end of `/qa-loop` to auto-file T3 findings.
---

# backlog-capture — fill the inbox (never rank)

A **producer**: it turns loose input into compact, correctly-routed **captured/open** rows
in the repo's own trackers. It is the front half of the pair — `/backlog-capture` fills the
inbox, **`/backlog` picks from it** (read `.claude/skills/backlog/SKILL.md`; consumer only,
never writes). It **does not rank, score, or decide** — that is `/backlog`'s job. It obeys
`loop-principles.md` (L1–L12, in the `dev-loop` folder): deterministic routing before any
judgement (L2), evidence over claims (L3), one small increment (L6), state externalised to
the tracker files (L7).

It exists to close a real gap: ideas and QA findings that only ever live in chat scrollback
get lost. This captures them into the durable docs the moment they appear.

## What it is NOT

- **Not a ranker.** No priority, no tier assignment, no "do this next." Effort is *advisory*
  (capture ≠ commitment). `/backlog` reads these rows and ranks; `/decide` processes a
  fully-scoped `*_HANDOFF.md`. No overlap — this files raw inbox rows.
- **Not a shipped-log writer.** It **never** writes a `## SESSION N — ✅ …` block or assigns
  a session number. A raw, unbuilt idea must not masquerade as shipped work. It writes only
  into the dedicated **`## 📥 CAPTURED — triage inbox (unbuilt)`** section (see ROUTING).
- **Not destructive.** Append-only. It never rewrites, reorders, or deletes existing lines,
  and never touches the `GO_LIVE_ISSUES.md` preamble (lines 1–36).

---

## THE THREE INPUTS

Detect the shape from the argument, then process **each item independently**:

1. **Raw idea** — freeform text (`"add a mute-notifications toggle"`). One item. Body = the
   text, trimmed to one line. Source = `input:<YYYY-MM-DD>`.
2. **GitHub issue URL** — matches `github.com/T29RNY/platform/issues/<n>`. Fetch it with
   **`gh issue view <n> --json title,body,labels --repo T29RNY/platform`** (one simple
   command — no pipes). Title/body/labels feed classification; source = the issue URL.
3. **Freeform bullet list** — many lines, each a `- ` / `* ` / numbered bullet. Split on
   lines, classify and route **each** independently. Source = `input:<YYYY-MM-DD>` per row.

If the shape is ambiguous (e.g. a single line that could be a title or an idea), treat it as
a **raw idea** — the cheapest correct default.

### `--from qa-loop` mode (producer hook for `/qa-loop` step 6)

Invoked as **`/backlog-capture --from qa-loop <T3 summary>`** at the end of a `/qa-loop` pass
to durably file its still-open **T3 findings** (which otherwise only surface in chat). The
input is qa-loop's T3 bucket, where each item carries an **intent question / design choice**, a
**ship-safety verdict** (from `check-live-config`), and a **drafted fix**. For each item:

- **Parse** the finding's subject as the title/body; ignore the drafted-fix diff (capture the
  *what*, not the patch).
- **Classify + route** with the normal STEP 1 + STEP 3 rules: a T3(a) gated defect →
  BUGS.md (`⚠️ SECURITY` if it's an auth/RLS/token/SECURITY-DEFINER finding; `📋 COMPLIANCE`
  if consent/GDPR/health/App-Store); a **production / pre-flight** item → GO_LIVE_ISSUES.md;
  a T3(b) feature-shaped design choice → FEATURES.md.
- **Effort** with the normal STEP 2 rubric.
- **Source link = `qa-loop <run-ref>`** (the run reference or date) — the row's provenance is
  the qa-loop pass, not a raw input.
- **Dedup + append** exactly as the normal path (STEP 4 + STEP 5), so a T3 re-surfaced on a
  later pass files nothing new.

This mode changes **only** how the input is parsed and the source link is stamped — routing,
dedup, append-only, and allowlist-safety are identical. It never alters `/qa-loop`'s
human-gated triage.

---

## STEP 1 — CLASSIFY (deterministic first · L2)

Assign exactly one class per item from signal in the text/title/labels:

- **feature** — a new capability, screen, flow, toggle, or enhancement to shipped behaviour.
- **bug** — a defect / tech-debt / regression in code that already ships.
- **security** — touches auth, RLS, a `SECURITY DEFINER` RPC, a player/admin/venue token
  flow, secret handling, or data-exposure. (A *kind of* bug — see routing.)
- **compliance** — under-18 / consent, UK-GDPR, health data, App-Store policy, or any legal /
  regulatory obligation.

When two could apply, prefer the more consequential: **security > compliance > bug > feature**
(a security-flavoured bug files as security). When genuinely unclear, classify **bug** and say
so in the row — never silently guess a feature.

## STEP 2 — ROUGH EFFORT (advisory only)

Net-new XS–XL taxonomy (orthogonal to the repo's TIER-1/2/3 *risk* scale — this is *size*):

- **XS** — one-liner / copy / flag / config.
- **S** — one RPC or one component; no migration.
- **M** — schema add + a few RPCs; 1 migration.
- **L** — multi-RPC / multi-screen; 2–3 migrations.
- **XL** — epic / cross-app / native / compliance audit.

Guess from the body; when unsure, pick the larger of two and mark it `~` (e.g. `~M`). The
operator or `/backlog` can override — this is a hint, not a commitment.

## STEP 3 — ROUTE (fixed table · decision locked at plan gate)

| Class | Destination doc | Tag on the row |
|---|---|---|
| feature / new capability | **FEATURES.md** | — |
| bug / tech-debt / defect in shipped code | **BUGS.md** | — |
| security (auth · RLS · SECURITY DEFINER · token flow) | **BUGS.md** | `⚠️ SECURITY` |
| compliance (under-18 · consent · UK-GDPR · health · App-Store) | **BUGS.md** | `📋 COMPLIANCE` |
| production incident needing a device / pre-flight recheck | **GO_LIVE_ISSUES.md** | — |

Security and compliance are **tags on a BUGS.md row**, not separate files — the repo has no
separate security or compliance tracker; BUGS.md is it.

## STEP 4 — DEDUP BEFORE APPEND (cheap, no DB · decision locked)

Before writing, grep the target doc **case-insensitive** for a short keyphrase from the item's
title (`bash skills/scripts/check-references.sh "<keyphrase>"` or a Grep-tool search on that
doc). **On a hit: skip the append and report the existing line** — do not double-file. Only a
clean miss appends. A re-run of the same input must therefore file nothing new.

## STEP 5 — APPEND THE CAPTURED ROW (one Write per doc · append-only)

Row shape (compact, one block — **never** a shipped-narrative block):

```
- 📥 **<short title>** — <class>[ <TAG>] · effort <XS–XL> · <one-line body> · source: <link> · captured <YYYY-MM-DD> · _open_
```

Examples:
- `- 📥 **Mute-notifications toggle** — feature · effort XS · per-player mute for match-day pushes · source: input:2026-07-01 · captured 2026-07-01 · _open_`
- `- 📥 **Admin token leaks in URL** — security ⚠️ SECURITY · effort S · /admin route exposes p_admin_token in referrer · source: https://github.com/T29RNY/platform/issues/42 · captured 2026-07-01 · _open_`

Write it into the destination doc's **`## 📥 CAPTURED — triage inbox (unbuilt)`** section:

- **If the section exists** (it is pre-seeded in all three docs): append the row as the last
  line of that section, above the following `---` / `##`. One Write.
- **If it is missing** (a doc that lost it): insert the section at the correct anchor first,
  then the row — **FEATURES.md / BUGS.md**: immediately after the `*Last updated: …*` line;
  **GO_LIVE_ISSUES.md**: after the preamble's closing `---` (never edit lines 1–36).
- On **FEATURES.md / BUGS.md** only, bump the `*Last updated: …*` line to note the capture.
  **Never** bump or touch the GO_LIVE_ISSUES.md preamble.

Section header + preamble (what the pre-seed looks like, so `/backlog` knows where to read):

```
## 📥 CAPTURED — triage inbox (unbuilt)
*Raw, unranked items filed by `/backlog-capture`. `/backlog` reads from here to pick work.
Not shipped work — no session number. Promote an item into the log below only once it's built.*
```

## STEP 6 — REPORT (plain English · operator preference)

Summarise in chat: for each item — class · effort · destination · **filed** or **skipped
(duplicate of `<line>`)**. Never a diff dump. One line per item.

## STEP 7 — REFRESH THE BOARD (best-effort · never fail the capture)

After filing, **refresh the published backlog board** so a newly-captured item shows up
right away. Follow `docs/backlog-board/RUNBOOK.md`: regenerate and **republish IN PLACE**
(Artifact tool, `url=` the canonical board URL — never mint a new one), then **print the
URL** back (hard rule). This is the ONE Artifact action in an otherwise docs-only skill,
so it is strictly **best-effort**: if running **unmanned/headless** (e.g. the
`--from qa-loop` hook) without Artifact access, **skip the republish, note the refresh is
owed, and never fail the capture over it.** Filing the row is the job; the board republish
rides on top.

---

## RUNS ALLOWLIST-SAFE (keeps an unmanned `/qa-loop` call from freezing)

Every command in the skill body must be **one simple, allowlisted command** — no compound
`cd`, no pipe / redirect / process-substitution / env-prefix (those miss the allowlist and
prompt a human, which would stall an unattended qa-loop call):

- Read the target docs with the **Read** tool; dedup with the **Grep** tool or a bare
  `bash skills/scripts/check-references.sh "<term>"`.
- Ingest a GitHub issue with a bare `gh issue view <n> --json title,body,labels --repo
  T29RNY/platform`.
- Append with **one Write per doc**. The three target-doc paths are in the committed
  `.claude/settings.json` `Write(...)` allowlist, so the writes run prompt-free.
- **No live-DB access. No migration. No app/RPC/SQL surface.** This skill is docs-only —
  the only non-docs action is the STEP 7 board republish (an Artifact publish, not a bash
  command or a DB/RPC/SQL touch), and it is strictly best-effort so it never stalls a run.

## HARD GUARDRAILS (never relaxed)

- **Files, never ranks** — no priority/tier/next-up; effort is advisory.
- **Append-only** — never rewrite, reorder, or delete an existing line; never a
  `## SESSION N` block; never a session number for unbuilt work.
- **Never touch the GO_LIVE_ISSUES.md preamble** (lines 1–36).
- **Dedup before every append** — a re-run of the same input files nothing new.
- **This project only** — the three docs in `/Users/tarny/platform/`; no other repo.

## Token discipline

Deterministic classify + route + dedup before any LLM judgement (L2); Read only the inbox
region and the dedup keyphrase, not whole docs; one Write per touched doc; batch a bullet
list in a single pass; don't re-read a doc already in context.
