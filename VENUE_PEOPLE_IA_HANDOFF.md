# Venue People & Spaces — IA Redesign (Handoff & Plan)

> **STATUS (2026-06-23):** Plan locked. **Phase 1 SHIPPED+MERGED (PR #78). Phase 2 SHIPPED this
> session (mig 409 — Teams page, three tabs + DataTable).** Venue-app only — the casual football app
> (`apps/inorout/src`) is NEVER touched. Each phase ships + merges before the next (cloud-session
> discipline). Next free migration when one is needed: **410**.
>
> **Phase 2 outcome (operator decision):** the Teams page is THREE clean tabs (operator's call —
> simpler than one list with badges): **League teams** (competition roster, full drill-down) ·
> **Casual bookings** (pitch bookers via the existing `venue_list_customers` — contact/bookings/spend,
> NO roster) · **Club teams** (new `venue_list_club_teams` reader). Players folded in (standalone
> Players item removed; page-level player search + redesigned roster table). Shared `DataTable`
> primitive built. **FOLLOW-UP LOGGED:** casual booking teams DO have rosters in the casual app and the
> venue *could* be shown them (the team books signed-in → team_id links the squad), but that crosses
> the casual↔venue consent wall — a deliberate later phase (decide the consent/opt-in model first),
> explicitly NOT folded into this IA epic.

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

### Phase 2 — Teams page  ✅ SHIPPED (mig 409, session 188)
- **THREE tabs** (operator decision — clean separation beats one badged list): **League teams**
  (`venue_list_active_teams`, "League" pill, full roster drill-down) | **Casual bookings**
  (`venue_list_customers` — bookers/walk-ins, contact/bookings/spend; NO roster) | **Club teams**
  (NEW `venue_list_club_teams`). Players folded in: standalone Players item REMOVED, redesigned
  roster TABLE + page-level player search (`venue_list_players`).
- Shared **`DataTable`** primitive built in `PageKit.jsx` (sortable, search, filter chips,
  empty/no-match, clickable rows) — reused by all three tabs + the roster.
- **Backend:** ONE new read RPC `venue_list_club_teams` (SECDEF, search_path, single overload,
  anon+auth, no audit). `venue_list_players` confirmed sufficient for player search. NO schema change.
- **Gates passed:** rpc-security PASS, build venue + hygiene 7/7 + hex hand-check, casual-regression
  PASS (core additive-only, inorout untouched), Playwright smoke PASS (0 console errors).
- **Main contact** column = Phase-4 placeholder ("—"), not wired.
- **Follow-up logged:** casual-team roster visibility (consent-gated, later phase — see status note).

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

## NEXT-SESSION KICKOFF PROMPT (paste-ready) — PHASE 3

```
Read VENUE_PEOPLE_IA_HANDOFF.md in full (Phases 1 & 2 SHIPPED+MERGED). Phase 1 = Rooms + Timetable
combined pages + "Club sessions"→"Team Training" + shared ViewSubhead/TabbedPage. Phase 2 (mig 409) =
the Teams page — THREE tabs (League teams / Casual bookings / Club teams) through TabbedPage, the new
shared DataTable primitive in apps/venue/src/views/PageKit.jsx (sortable/search/filter-chips/clickable
rows — REUSE it, don't rebuild), redesigned TeamDetail roster table, page-level player search, and the
Players rail item removed. Then read apps/venue/src/views/Dashboard.jsx (TABS/COMBINED/render),
MembershipsView.jsx (members live here today — EnrolModal/ProfileModal + venue_list_members), and in
RPCS.md the members + member_guardians readers (venue_list_members, member_guardians, get_member_pass).
Venue-app ONLY; the casual football app (apps/inorout/src) is NEVER touched. Confirm next free mig off
origin/main only if one is needed (Phase 3 should be read-only — likely no migration).

Run a full AUDIT → VERIFY (review) → EXECUTE → VERIFY → COMMIT cycle (skills/audit.md FIRST, report
findings before editing). PHASE 3 — Members + Guardians:
- A "Members" page (or a combined page if it reads better) with a Members table + a Guardians view
  (tab or filter) showing each guardian and who they are guardian OF (member_guardians relationships).
  Reuse the Phase-2 DataTable for both. Plain-English ViewSubhead on each.
- Backend: a members reader that returns the guardian relationships (extend/confirm the existing
  venue_list_members / member_guardians readers; read-only). If a reader changes, single overload,
  search_path pinned, venue_* grant anon+auth per the gotcha, reads no-audit.

GATES: rpc-security-sweep (any reader added/changed); build venue + hygiene 7/7 + hex hand-check;
casual-regression ONLY IF packages/core/storage/supabase.js gains a wrapper (additive-diff proof);
Playwright smoke (Members table + Guardians view render, guardian→member links show, search/filter
works, 0 console errors). Update RPCS/SCHEMA/FEATURES if a reader changes; then PR → merge to main
before Phase 4. End by giving the Phase 4 next-session prompt in chat.
```
