# Backlog Board — refresh runbook

The **backlog board** is a published Artifact: a single dashboard of every open item
across the platform, with columns **Item · Class · Effort · Status · Progress% ·
Remaining · Value**. It exists so the operator can see the whole outstanding backlog at
a glance, with progress verified against the *code*, not the doc headers.

## The one URL — never mint a new one

> **https://claude.ai/code/artifact/8192ebc0-89a4-4791-b70f-0f66f3b47d3f**

This is the canonical board. Every refresh **updates this URL in place**. Do **not**
create a second board.

- In the session that first published it, re-publishing the **same file path** redeploys
  to this URL automatically.
- From **any other session** (a later chat, `/backlog`, `/backlog-capture`, or the
  scheduled refresh routine), publish with the Artifact tool's **`url=`** parameter set
  to the URL above — otherwise a new URL is minted, which is wrong.

## HARD RULE — always surface the URL

**Every refresh MUST print the board URL back to the operator**, whether or not anything
changed. They should never have to ask for it. End every refresh with a line like:
`📋 Backlog board updated → https://claude.ai/code/artifact/8192ebc0-89a4-4791-b70f-0f66f3b47d3f`

## Regeneration recipe

1. **Survey (deterministic first).** `bash skills/scripts/survey-backlog.sh` — in-flight
   epics + phase statuses, open bugs/owed, the FEATURES tracker, open PRs.
2. **Verify-first reconciliation (the load-bearing step).** Grep the code / migrations /
   components so any "scoped" item that is **already built** is excluded or moved to a
   higher progress %. The board's entire value is that progress% is verified against the
   code, not the doc headers — several `docs/epics/*.md` manifests lag reality.
   Do this in a **scoped sub-agent** to keep the main context small.
3. **Sources to fold in:** `docs/epics/*.md` phase statuses; the `## 📥 CAPTURED — triage
   inbox` sections of `BUGS.md` / `FEATURES.md` / `GO_LIVE_ISSUES.md`; open PRs
   (`gh pr list`); MEMORY recall for active threads.
4. **Regenerate the HTML** from the committed template
   [`backlog-board.html`](./backlog-board.html) — keep the **5 groups** (In flight ·
   Scoped-unbuilt · Small wins · Blocked/frozen · Housekeeping) and the **7 columns**.
   Update the row data + the KPI tiles + the "As of" date. Keep the dark-first design,
   brand-blue `#60A0FF` accent, and the app's Bebas/DM-Sans system.
5. **Republish IN PLACE** — Artifact tool, `url=` set to the URL above.
6. **Print the URL** (HARD RULE above).

## Classification key (keep consistent)

- **Class:** feature · bug · security · compliance · chore · tooling · epic · debt.
- **Effort (size, not risk):** XS one-liner/config · S one RPC/component · M schema +
  a few RPCs / 1 migration · L multi-RPC / multi-screen / 2–3 migrations · XL epic /
  cross-app / native / compliance.
- **Status:** owed (built, needs walk/deploy) · scoped · blocked · frozen · not started ·
  PR open · plan gate · your action.
- **Value:** high / med / low — user + commercial impact, not urgency.

## Who refreshes it

- **On change (instant):** `/backlog` and `/backlog-capture` each end by following this
  runbook (their closing "Refresh the backlog board" step).
- **On a schedule (safety net):** a daily cloud routine runs this runbook so the board
  stays current even for changes that never ran a backlog command (merges, deploys,
  shipped phases). If a refresh runs **headless/unattended and cannot publish the
  Artifact**, it must not fail — note that the visual republish is owed and continue; the
  data is still captured by the survey.
