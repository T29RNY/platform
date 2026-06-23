# Venue People & Spaces — IA Redesign (Handoff & Plan)

> **STATUS (2026-06-23):** Plan locked. **Phase 1 SHIPPED+MERGED (PR #78). Phase 2 SHIPPED+MERGED
> (PR #79, mig 409 — Teams page). Phase 3 SHIPPED this session (mig 410 — Members + Guardians page).**
> Venue-app only — the casual football app (`apps/inorout/src`) is NEVER touched. Each phase ships +
> merges before the next (cloud-session discipline). Next free migration when one is needed: **411**.
>
> **Phase 3 outcome:** a new read-only **Members** rail item (People group) → `MembersView` with two
> tabs (Members / Guardians) through `TabbedPage` + the Phase-2 `DataTable`. Backend = `venue_list_members`
> extended ADDITIVELY (mig 410) with `dob` + a `guardians[]` array (from `member_guardians`); the
> supabase.js wrapper is unchanged (pass-through), so the legacy MembershipsView Members tab is
> byte-identical and there's no casual surface. The operational enrol/freeze/cancel/grade machinery
> stays on the Memberships screen until the Phase-5 consistency sweep (intentional brief overlap).
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

### Phase 3 — Members + Guardians  ✅ SHIPPED (mig 410, session 188)
- New read-only **Members** rail item (People group) → `MembersView` = **Members** tab (name, age/U18
  flag, discipline, plan, status, inline guardian) + **Guardians** tab (each guardian + the members they
  look after, de-duped by member profile), via `TabbedPage` + the Phase-2 `DataTable` + `ViewSubhead`.
- **Backend:** `venue_list_members` extended ADDITIVELY (mig 410) — each member row now embeds `dob`
  (COALESCE profile→customer) + a `guardians[]` array from `member_guardians`. Read-only, no audit.
  supabase.js wrapper UNCHANGED (pass-through) → no new wrapper → casual-regression N/A.
- The Guardians view is **derived client-side** by inverting `guardians[]` (one reader, one source).
- Operational membership management stays on the Memberships screen (Phase-5 sweep removes the overlap).
- **Gates passed:** rpc-security PASS, build venue + hygiene 7/7 + hex hand-check, Playwright smoke PASS
  (23 members + U18 badges + inline guardians, Guardians links + dedup, cross-field search, 0 new errors).

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

## NEXT-SESSION KICKOFF PROMPT (paste-ready) — PHASE 4

```
Read VENUE_PEOPLE_IA_HANDOFF.md in full (Phases 1, 2 & 3 SHIPPED+MERGED). Phase 1 = Rooms + Timetable
combined pages + "Club sessions"→"Team Training" + shared ViewSubhead/TabbedPage. Phase 2 (mig 409) =
the Teams page (THREE tabs through TabbedPage + the shared DataTable in apps/venue/src/views/PageKit.jsx
— REUSE it, don't rebuild — with a Phase-4 PLACEHOLDER "Main contact" column on the Club teams tab,
rendered "—"). Phase 3 (mig 410) = the Members page (MembersView — Members + Guardians tabs, venue_list_members
extended additively with dob + guardians[]). Then read apps/venue/src/views/TeamsView.jsx (LeagueTeamsTab +
ClubTeamsTab — where the Main contact column lives), CustomersView.jsx (the venue_customers people directory
+ the existing customer modal), and in RPCS.md the venue_customers readers + venue_list_active_teams /
venue_list_club_teams. Venue-app ONLY; the casual football app (apps/inorout/src) is NEVER touched.
Confirm next free mig off origin/main (Phase 4 ADDS a write + likely a column/link table → mig 411).

Run a full AUDIT → VERIFY (review) → EXECUTE → VERIFY → COMMIT cycle (skills/audit.md FIRST, report
findings before editing). PHASE 4 — Main contact (settable) + people directory + contact picker:
- A settable "Main contact" column + filter on BOTH Teams tabs (League teams + Club teams). The link
  POINTS AT AN EXISTING venue_customers person via a ContactPicker (search the directory / pick / create
  → links to a venue_customers row, NEVER free text — same "one customer per human" principle as Stripe P1).
- Backend (NEW + a WRITE): decide in audit whether the team→person link is a column on the team rows or a
  tiny link table (teams live in two tables — `teams` for league, `club_teams` for club — so a small
  polymorphic link table keyed on (team_kind, team_id) likely reads cleanest). A set/clear write RPC
  (gated, audited per Hard Rule #9) + a people-search reader. SECDEF, search_path pinned, single overload,
  venue_* grant anon+auth per the gotcha; the write GRANTed to the right role + REVOKEd from anon if needed.

GATES (Phase 4 is the riskiest — it writes): rpc-security-sweep; EPHEMERAL-VERIFY (own _e2e_ fixture,
leak 0 — mandatory for the new write RPC); build venue + hygiene 7/7 + hex hand-check; casual-regression
ONLY IF packages/core/storage/supabase.js gains a wrapper (additive-diff proof); Playwright smoke (set a
main contact via the picker on a team, see it render + filter, clear it, 0 console errors). Same-commit
SCHEMA/RPCS/FEATURES/DECISIONS/BUGS. PR → merge to main before Phase 5. End by giving the Phase 5
next-session prompt in chat.
```
