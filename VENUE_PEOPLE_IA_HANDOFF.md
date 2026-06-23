# Venue People & Spaces — IA Redesign (Handoff & Plan)

> **STATUS (2026-06-23):** Plan locked. **Phase 1 IN PROGRESS this session.** Venue-app only —
> the casual football app (`apps/inorout/src`) is NEVER touched. Each phase ships + merges before
> the next (cloud-session discipline). Next free migration when one is needed: **409**.

## GOAL

One learnable model for the venue operator: a **short rail of pages, each with related tabs,
each a table with a plain-English subheading + filters**. One human = one record (no contact
re-fragmentation). The win is *consistency* — the operator learns ONE interaction model.

**Target rail (People & Spaces area):** Members · Teams · Staff · Rooms · Timetable.
Customers leaves the menu; its records stay as the backing people directory.

## SETTLED DECISIONS (operator-confirmed)

- **Customers page → removed from the rail.** "Customer / main contact" becomes a **settable
  column + filter on each team** (casual + league). The underlying `venue_customers` records
  **stay** as the directory, reachable via the contact picker + global search. The main-contact
  link **points at an existing person record** (a picker), never free text — same "one customer
  per human" principle as Stripe Phase 1.
- **Members** = a table of members **and** guardians, showing who each guardian is guardian of.
- **Teams** = one page, tabs **Teams** (casual + league from the `teams` table, "League" badge +
  filter) and **Club teams** (`club_teams` membership layer). Players are a **drill-down inside a
  team** + a **global player search** — no standalone Players nav item.
- **Staff** = table.
- **Rooms** = one page, tabs **Spaces** (your rooms — config) | **Room bookings** (renting them out).
- **Timetable** = one page, tabs **Classes** (booked) | **Team Training** (RSVP'd — renamed from
  "Club sessions").
- **Pattern everywhere:** page-with-tabs + a shared `DataTable` + a `ViewSubhead` one-liner.

## DATA MODEL NOTES (audited 2026-06-23)

- **Three "team" concepts:** `teams` (casual + league — SAME table; a team can book a pitch AND
  enter a competition), and `club_teams` (the membership layer, junction to `clubs`+`club_cohorts`).
  Casual and league teams live together (distinguish with a "League" badge from `competition_teams`);
  club teams are genuinely separate rows. Confirmed in SCHEMA.md.
- **Main contact data is scattered:** `venue_list_active_teams` (league) returns only name+colours,
  no contact. Casual booking teams carry a contact via `pitch_bookings` (`contact_email`/`phone`,
  auto-linked to `venue_customers.id` via `pitch_bookings.customer_id`). So a **main-contact link is
  NEW** — Phase 4 adds it (link a team of either kind → a `venue_customers` person + a settable
  write RPC). For league-only teams with no booking, the operator sets it manually.
- **`venue_customers`** = the venue's people/booker directory (name/email/phone/guardian/emergency).
  Stays as the backing store for the contact picker.
- **`MembershipsView` is overloaded** — it currently also holds the club org chart (where club teams
  live), grading, fight records, fees, partners, policies, ID submissions, merchandise, club leagues
  & fixtures. This epic extracts only **Members** (Phase 3) and **Club teams** (Phase 2). The rest
  stays put — a separate tidy later (NOT in scope here).

## RAIL / ROUTING MECHANICS (audited)

`apps/venue/src/views/Dashboard.jsx` owns it all:
- `TABS` — groups → items `{ id, label, icon, flag?, cupOnly?, adminOnly?, facilityOnly? }`.
- `VIEW_FLAG` — derived `{id: flag}`; the route gate bounces a view whose flag is off.
- `featureOn(features, flag)` — fail-open (missing flag = on).
- `TITLES` — `{id: "Title"}`.
- `Rail` — filters items by `featureOn(flag)` AND `itemDisciplineRelevant(disciplines, id)`
  (`lib/featureRelevance.js` `ITEM_KIND`: `classes`→PT disciplines, `teams`/`players`→competition;
  `sessions`/`spaces`/`roomhire` not discipline-gated).
- A big `view === "x" && <XView/>` render switch.

**Combined-page pattern (Phase 1):** a combined item carries `subs: [{id,label,flag,kind?}]`
(kind = the original id, so existing flag + `ITEM_KIND` rules still apply per sub). The rail shows
the item if ANY sub passes (`featureOn(flag) && itemDisciplineRelevant(kind)`); the page renders the
passing subs as tabs (collapses to a bare view when only one qualifies). Legacy ids (`spaces`,
`roomhire`, `classes`, `sessions`) alias to the combined view + default tab so deep links / Search
still resolve.

---

## PHASES (each a self-contained AUDIT→EXECUTE→VERIFY→COMMIT cycle)

### Phase 1 — Foundations + Rooms + Timetable + rename  ⬅ THIS SESSION
- Shared primitives: `ViewSubhead` (plain-English one-liner) + `TabbedPage` (renders qualifying
  sub-views as tabs / bare when one). (`DataTable` built in Phase 2 where first consumed.)
- **Rooms** page = Spaces | Room bookings tabs (merges SpacesView + RoomHiresView).
- **Timetable** page = Classes | Team Training tabs (merges ClassesView + SessionsView); **rename
  "Club sessions" → "Team Training"** everywhere (Dashboard TITLES/TABS, featureRelevance comment).
- Rail/render/gate updated for the combined-page pattern + legacy-id aliases.
- Subheads added to the four merged views.
- **Backend:** none. **Gates:** venue build + hygiene + hex hand-check + Playwright smoke (both
  pages render, tab-switch works, 0 console errors). Casual-regression N/A (no `apps/inorout/src`,
  no `supabase.js`).

### Phase 2 — Teams page
- Tabs **Teams** (casual + league, "League" badge + filter) | **Club teams**. Players folded in as a
  team drill-down (redesigned roster modal — TABLE form) + a **global player search** box.
- Build the shared **`DataTable`** here (first consumer).
- **Backend:** venue-scoped **club-teams reader** + **search-players reader** (extend/confirm).
  Read-only.
- **Gates:** rpc-security (any reader changed), build + hygiene, casual-regression (additive-diff if
  `supabase.js` gains a wrapper), Playwright smoke.

### Phase 3 — Members + Guardians
- **Members** table + a **Guardians** view (tab/filter) showing each guardian + who they guardian.
- **Backend:** members reader returns `member_guardians` relationships. Read-only.
- **Gates:** rpc-security, build + hygiene, casual-regression (additive), Playwright smoke.

### Phase 4 — Main contact (settable) + people directory + contact picker
- **Main contact** column + filter on both Teams tabs; a **ContactPicker** (search directory / pick /
  create → links to a `venue_customers` person, no free text).
- **Backend (NEW + a write):** a team→person main-contact link (column or tiny link table — decide
  in audit), a **set/clear write RPC** (audited, EV-gated), a **people-search reader**. Migration.
- **Gates:** rpc-security-sweep, **ephemeral-verify** (own `_e2e_` fixture, leak 0), build + hygiene,
  casual-regression (additive), Playwright smoke. Same-commit SCHEMA/RPCS/DECISIONS/BUGS.

### Phase 5 — Drop Customers from the rail + consistency sweep
- Remove the **Customers** nav item (records remain, reachable via picker + search).
- Final tables + plain-English subheadings on anything still card-based (Staff, leftovers).
- **Backend:** none. **Gates:** build + hygiene + Playwright smoke.

## SEQUENCING & RISK
- Order 1→5, each merged before the next (avoid two PRs on shared files).
- Riskiest: Phase 4 (new data + a write) — fully EV-gated. Phase 2 = biggest front-end lift.
- Venue app = **manual prebuilt-static deploy** (platform-venue) — each phase ends with a manual
  deploy + a real-browser eyeball (build/hygiene can't see "tap does nothing").

## OUT OF SCOPE (this epic)
- Relocating grading / fight records / fees / merchandise / policies out of MembershipsView.
- Unifying `venue_customers` with the member/`people` identity spine.
- Any casual football app / consumer surface change.

---

## NEXT-SESSION KICKOFF PROMPT (paste-ready) — PHASE 2

```
Read VENUE_PEOPLE_IA_HANDOFF.md in full (Phase 1 is SHIPPED+MERGED — Rooms + Timetable combined
pages, "Club sessions"→"Team Training" rename, shared ViewSubhead + TabbedPage primitives, rail
combined-page pattern with per-sub flag+discipline gating + legacy-id aliases). Then read
apps/venue/src/views/Dashboard.jsx (TABS/render/Rail), TeamsView.jsx + TeamDetail.jsx (league teams +
the roster modal), MembershipsView.jsx (where club teams live today, in the org chart), and the
readers venue_list_active_teams / the club-teams + players readers in RPCS.md. Venue-app ONLY; the
casual football app is never touched. Confirm next free mig off origin/main if a migration is needed.

Run a full AUDIT → VERIFY (review) → EXECUTE → VERIFY → COMMIT cycle (skills/audit.md FIRST, report
findings before editing). PHASE 2 — Teams page:
- One page, tabs: "Teams" (casual + league from the `teams` table, with a "League" badge + filter
  derived from competition_teams) and "Club teams" (`club_teams` membership layer, currently buried
  in the MembershipsView org chart). Players folded in as a team drill-down (redesign the roster
  modal into TABLE form, more info) + a global player-search box at page level. NO standalone Players
  nav item (already removed conceptually).
- Build the shared DataTable primitive here (first consumer): sortable columns, search, filter chips,
  empty state, row actions. Reuse it for both tabs.
- Backend: a venue-scoped club-teams reader + a search-players reader (extend/confirm existing;
  read-only). The main-contact column is PHASE 4 — leave a placeholder column, don't wire it yet.

GATES: rpc-security-sweep (any reader added/changed — single overload, search_path pinned, venue_*
grant anon+auth per the gotcha, reads no-audit); build venue + hygiene 7/7 + hex hand-check;
casual-regression ONLY IF supabase.js gains a wrapper (additive-diff); Playwright smoke of the Teams
page (both tabs render, drill-down opens the roster modal, search filters, 0 console errors). Update
RPCS/SCHEMA/FEATURES if a reader changes; then PR → merge to main before Phase 3.
```
