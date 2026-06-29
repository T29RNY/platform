---
name: backlog
description: On-demand backlog picker. Run it at the laptop to survey what's done / scoped / next-actionable across the platform, get a ranked shortlist with ship-safety + tier tags, pick one in chat, and have it launched UNMANNED through the dev-loop. Use when the operator asks "what should I work on", "pick the next thing", "what's next", "show me the backlog", or wants to start the next piece of work without hand-holding. Surveys, recommends, then on a pick runs /dev-loop (single change) or /loop /dev-loop (epic) hands-off to the human gates.
---

# backlog — on-demand picker → unmanned launch

A front door for "what do I do next, and just get on with it." Three steps: **SURVEY →
PICK → LAUNCH UNMANNED.** It does not itself build — it selects, then hands off to
`dev-loop` (read `.claude/skills/dev-loop/SKILL.md`; this skill obeys all of its
guardrails). Keep the operator's surface to one decision: *which item*.

## 1 — SURVEY (cheap signal first · L2, L8)
- Run `bash Skills/scripts/survey-backlog.sh` — deterministic snapshot of in-flight
  epics (+ phase statuses), open bugs/owed, the FEATURES tracker, and open PRs.
- Layer on MEMORY recall (active threads) for anything not in the repo files.
- **Verify-first (the highest-value step · L10):** before listing a "scoped" item as
  remaining work, cheaply check whether it's *already built* — grep migrations / RPCs /
  components. The Gaffer epic had 2 of its phases already done; never present built
  work as todo. Do this reconciliation in a **scoped sub-agent** so the main context
  stays small.

## 2 — RANK & PRESENT (one decision for the operator)
Produce a short ranked shortlist (≈5–8 items, not the whole universe). For each:
- **title** · **tier** (1 = UI/copy/flag-gated · 2 = logic/RPC · 3 = migration/RLS/
  money/auth/deploy) · **ship-safety** (run `Skills/scripts/check-live-config.sh` on
  the likely files → CLEAR / PROTECTED) · **real remaining work** (post verify-first) ·
  **rough size**.
- **Bias the recommendation by what's safe to ship *now*:** while a build is in Apple
  review, prefer **dark-in-prod / flag-gated** work (e.g. anything behind
  `VITE_GAFFER_ENABLED`) that can't touch the frozen auth/native surface. Flag any pick
  that is FROZEN or tier-3-heavy so the operator chooses with eyes open.
- Ask **"which one?"** in plain chat text (never a popup — operator preference). Offer
  your top recommendation first with one line of why.

## 3 — LAUNCH UNMANNED (once they pick)
The operator names the item; from there, run **hands-off** through the dev-loop:
- **Epic** (multi-phase): ensure `docs/epics/<name>.md` exists — draft it from
  `phase-manifest.template.md` if missing and take the **one-time batched plan-gate
  approval** in the same breath as the pick — then run `/loop /dev-loop <manifest>`.
- **Single change**: run `/dev-loop <the change, with its done-check>`.
- Set the autonomy the operator chose (manifest `Merge mode`); default `per-phase`.

**What "unmanned" means here (be honest about it):** the loop runs
audit → build → prove → fresh-context review → PR **without prompting** — it
auto-proceeds the plan gate on unambiguous tier-1 work and corrects itself to green.
It still **surfaces, batched and minimal,** only the things where the operator's
judgment is real or the action is irreversible:
- **Merge to `main` = a live production deploy** (casual team + the App-Store binary's
  web bundle) — so it stops at the merge gate with a one-line ship-safety verdict,
  unless the epic opted into `Merge mode: auto` for CLEAR tier-1 (then it self-merges
  those).
- **Tier-3** (migration/RLS/money/auth/deploy) → drafts + proves, then asks a
  plain-English **intent** question ("this lets X read Y — intended? y/n"), never a
  "review this diff".
- **Apple-review freeze** → auth/session/routing/native changes are held.
So: it gets the *work* done unattended and saves you a small, batched set of
intent/merge decisions — it does not blind-merge into live prod. That ceiling is by
design while a real team and an Apple submission are live.

## Token discipline
Deterministic survey before LLM ranking; scoped sub-agents for survey + review; read
only what's needed; don't re-survey settled items mid-run. One pick → one launch.
