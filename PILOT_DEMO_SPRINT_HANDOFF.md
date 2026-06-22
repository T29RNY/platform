# Pilot Demo Sprint — Handoff & Scope

**Goal:** land the **wider-management demo (~2026-06-29)** for the multi-age football
club (Club/Org SKU buyer). Source of asks = `STRATEGY.md` → "PILOT MEETING FEEDBACK
(2026-06-22)" prioritised backlog. The org/team-structure epic (backlog #2) is **complete**
(migs 389–393); this sprint is the next, demo-driven run.

**The run (in order):** #8 → #9 → #4 → #10, with the **#1 FA feasibility spike** in parallel.
Work one at a time, full `AUDIT → EXECUTE → VERIFY → COMMIT` per item (per CLAUDE.md).

**⚠️ Next free migration = 394.** Re-confirm off `main` before any SQL.

---

## #8 — Opposition-coach matchday info link · Low · 🔴 #2 demo

**Ask:** a shareable link an opposition coach opens to see the matchday essentials for a
fixture (teams, date/time, pitch, ref, venue address/directions) — in *our* design, no login.

**Reuse (audited):** the tournament public-hub pattern is the template —
`get_tournament_public` RPC + `apps/inorout/src/views/TournamentScreen.jsx` (public route
`/tournament/<slug>`), and `FixtureDetailCard.jsx` for the per-fixture sheet. The reception
display already renders matchday info too.

**Likely shape:** a public read RPC (mirror `get_tournament_public`) keyed on a fixture id or
a short share code, + a public route/view rendering it, + a "Share matchday link" action on the
venue/admin fixture surface. Anon-readable; no writes. Confirm in audit whether to key on an
existing fixture token or mint a share code.

**Demo framing:** "Send the away coach one link — they see kickoff, pitch, and directions,
branded as your club."

---

## #9 — Embed code (fixtures/results on the club's own website) · Low · 🟢 easy win

**Ask:** put fixtures/results/tables on the club's own website.

**Reuse (audited):** our public league views already exist —
`CompetitionStandingsCard.jsx`, `CompetitionFixturesCard.jsx`, `apps/venue` `LeagueTable.jsx`.
Plus the **FA official Code Snippets** embed (display-only widget; see STRATEGY.md FA verdict).

**Likely shape:** a settings panel that (a) surfaces the FA official snippet for paste, and
(b) gives an **iframe/embed snippet for our own public standings/fixtures view** so a club can
drop our branded table onto their site. Mostly UI + a public embeddable route; verify our
public league view can render standalone (no app chrome) for iframing.

**Demo framing:** "One snippet, your fixtures live on your website — ours, styled like you."

---

## #4 — Coach invoice-chasing (paid/unpaid pill + auto-reminders) · Low–Med · 🟠 show

**Ask:** coaches shouldn't chase money manually — see who's unpaid; reminders auto-send.

**KEY AUDIT FINDING — the reminder engine already exists.** `apps/inorout/api/cron.js`
(~line 749) runs a daily **membership-reminder** job via the service-role RPC
`get_membership_reminders_due`; it **no-ops cleanly until `RESEND_API_KEY` is set**. So the
"auto-send" half is largely built — the work is (a) confirm/extend what it covers and (b) the
coach-facing view.

**Reuse (audited):** charges ride the shared `venue_charges` ledger; venue-side payment surfaces
exist (`PaymentsView.jsx`, `CustomerDetailModal.jsx`). Membership amounts on `venue_memberships`.

**Likely shape (MVP):** a **paid / unpaid pill on the team's player/member list** (read on
existing ledger + membership data — the coach-facing equivalent of PaymentsView), plus verifying
the existing reminder cron covers overdue member charges (extend the `get_membership_reminders_due`
RPC if it only covers renewals, not arrears). Stripe stays dormant — pills + reminders run on
*recorded* charges, which is enough for the demo. Per Hard Rule #9, any new write RPC audits;
any cron change keeps the `RESEND_API_KEY`-absent no-op.

**Demo framing:** "Coach opens the squad — red pill = owes. Reminders go out on their own.
No spreadsheet, no awkward texts."

---

## #10 — Simplify Venue OS UI · Med · 🔴 #3 demo

**Ask (their words):** "too many similar-sounding options."

**Reuse (audited):** no new features — an **IA / labelling pass** over the venue app
(`apps/venue/src/views/*` — MembershipsView, PaymentsView, LeagueView, EquipmentView, etc. and
the venue nav). Group/rename/merge confusingly-similar entries; reduce top-level noise.

**Likely shape:** audit the venue nav + each view's option labels, propose a grouped IA
(surface the proposal in chat before editing — operator reviews naming, per
`feedback_schema_question_framing`/plan-in-session), then a labelling/grouping pass. Pure
front-end; no schema. Venue app is **not** hygiene-hook-gated, so check hardcoded hex by hand
(BUGS.md s174 venue-hex tech-debt is in this area — fold the fix in if cheap).

**Demo framing:** "Same power, half the menu — they said it was busy, here's the cleaned-up
console."

---

## #1 — FA Full-Time sync (paste-a-URL route) · feasibility SPIKE FIRST · 🔴 kingmaker

**Operator's reframe (2026-06-22):** build it like a **calendar-feed connection** — club pastes
a feed URL, our backend polls (~24h, tighter near matchday), diffs, and **alerts on fixture
changes**. This is the legit route, not the grey-area login-scrape.

**Spike scope (NO code — ~1–2 hrs, output is a go/no-go + route writeup in STRATEGY.md):**
1. Confirm a club admin can still **obtain a feed URL** per league/division from FA Full-Time
   today (the FA has been locking feeds + migrating to "Matchday" — this is the make-or-break
   unknown). Check the Code Snippets / feeds area; capture a real sample feed URL + format
   (XML / RSS / iCal).
2. Confirm the feed is **per-division** (contains all teams) → a multi-team club pastes one URL
   per division they play in.
3. Confirm the data carries enough to **diff for changes** (fixture id, date/time, venue) and to
   map to our teams via a **one-time setup mapping** (FA team name → our `club_team`), avoiding
   fragile runtime exact-string matching.
4. If feeds are gone: fall back to the **official display-only embed** (#9) and frame the
   our-design + change-alerts version as "a partnership conversation as we grow" (do not
   over-claim in the demo).

**If go:** the build (next sprint, not pre-demo) = a feeds table + paste-URL setting + a poller
cron (reuse the cron.js pattern) + a differ + change-alert via the existing broadcast/email
plumbing + the setup name-mapping UI.

---

## GATES (per item, per CLAUDE.md)

- SQL first (Supabase) → wrapper → call site. Migration source file + apply same commit (Hard #11).
- `rpc-security-sweep` for any new/changed RPC (DROP old overloads on param change).
- `ephemeral-verify` for any new write RPC (own `_e2e_` fixture, auto-rollback, leak-check 0).
- `casual-regression` (additive-diff) for any `apps/inorout/src` touch.
- Build clean (inorout + venue), hygiene 7/7 on client files, Playwright boot smoke.
- ⛔ real-iPhone PWA walk owed for any `apps/inorout/src` member-facing change (Hard #13).
- Update STRATEGY.md backlog status + FEATURES/DECISIONS/BUGS per item.

---

## NEXT-SESSION KICKOFF PROMPT (paste-ready)

```
Read PILOT_DEMO_SPRINT_HANDOFF.md in full, then CONTEXT.md and BUGS.md.
The org/team-structure epic is COMPLETE (migs 389–393). We are now running the
pilot demo sprint for the ~2026-06-29 wider-management demo.

Run, ONE AT A TIME, a full AUDIT → EXECUTE → VERIFY → COMMIT cycle per item, in order:
  #8 Opposition-coach matchday info link  (reuse get_tournament_public / FixtureDetailCard)
  #9 Embed code (FA official snippet + an embeddable version of our public league views)
  #4 Coach paid/unpaid pill + auto-reminders (REUSE the existing membership-reminder cron
     get_membership_reminders_due in api/cron.js — confirm/extend coverage; add the
     coach-facing per-team paid/unpaid pill)
  #10 Simplify Venue OS UI — IA/labelling pass over apps/venue (propose the grouped IA in
     chat for my review BEFORE editing; no new features)

In parallel, run the #1 FA Full-Time feasibility SPIKE (no code): confirm a club can still
obtain a per-division feed URL from FA Full-Time today, capture format + a sample, and write
a go/no-go + route writeup into STRATEGY.md. If go, scope the paste-URL + poll + diff +
change-alert + name-mapping build (do NOT build it this sprint unless I say so).

AUDIT each item before touching code; surface ambiguities as ONE chat question (no popups).
Confirm next free migration before any SQL (should be 394). Gates per item: rpc-security-sweep,
ephemeral-verify (new write RPCs), casual-regression (apps/inorout/src touches), build +
hygiene + Playwright smoke. Update STRATEGY.md backlog status + FEATURES/DECISIONS/BUGS per
item, same commit. Show diffs before committing; commit + push per item. ⛔ real-iPhone walk
owed for member-facing apps/inorout/src changes (Hard Rule #13).
```
