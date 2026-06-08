# Venue Dashboard — Functional Brief

> Read `README.md` first. This brief is functional only — no style direction. Use the
> field names from the **Data contract appendix** at the bottom; design every state.

---

## Surface header

**Product context.** The Venue dashboard is the control room for a single sports venue.
The operator uses it to run the night: see which matches are on tonight, assign pitches
and referees, confirm pitch bookings, take payments, manage teams/players/staff, set up
seasons, and configure the reception TV. It is the busiest, most feature-dense of the
four surfaces.

**Who uses it + device.** One venue operator (sometimes a small team). Frequently used
**one-handed on a phone at the pitchside**, but also on a desktop in the office. Must work
well at both sizes — several screens have an explicit mobile variant (noted per screen).

**Auth / launch.** The operator opens a private link containing a venue **admin token**
(in the URL — either `?token=…` or `/venue/<token>`). No username/password. If no token
is present, a small **token-entry form** is shown. The token is validated by loading the
venue state; design the three entry states: **token form**, **loading**, **error (with a
Retry)**.

**App shell.**
- **Header**: venue name, the active league(s), an **On Air / Standby** status (On Air when
  one or more matches are live), a live clock (time + date), and action buttons for
  **Season setup** and **Reception display** settings.
- **Ticker**: a slim scrolling strip of headline counts (pitches, referees, this-week
  fixtures, pending registrations, open incidents).
- **Tab nav**: `Operations · Bookings · Payments · Teams · Players · Staff · League ·
  Table · Cups`. The **Bookings** tab shows a badge with the count of pending booking
  requests. The **Cups** tab only appears if the venue has a knockout/group competition.
- **Global states**: loading (whole-app), error (whole-app, with retry).

---

## Screen 1 — Operations (default tab)

**Purpose.** At-a-glance command of tonight's matches, the rest of the week, recent
results, and anything needing action.

**Audience / role.** Venue operator (full control).

**Data shown.**
- **Tonight (hero):** a prominent block.
  - If no matches tonight: an empty "floodlights down" state with a **Next up** teaser
    (next fixture's date + the two team names).
  - If matches tonight: a list of **fixture cards** (see *Fixture card* below), shown
    prominently. An **On Air** badge appears if any are live.
- **This week:** the rest of this week's fixtures (excluding tonight) as fixture cards.
- **Recent results:** up to ~10 most-recent completed fixtures (compact cards with score).
- **Upcoming:** up to ~10 future fixtures (compact cards).
- **Open issues:** combined count of **pending team registrations** + **open incidents**.
  - Pending registration row: team name + **Approve** / **Reject** buttons.
  - Open incident row: a **severity** badge (critical / warning / info) + description.
- **Sidebar — Pitches:** each pitch shows name, surface, capacity, and any maintenance
  windows; **Add** / **Edit** buttons.
- **Sidebar — Officials (referees):** each shows name, preferred contact channel,
  employment type (freelance / in-house), rating, active/retired; **Add** / **Edit**.

**Fixture card** (reused across Operations and elsewhere):
- Kickoff time + date.
- **Status pill**, one of: *Needs pitch, Needs ref, All set, Live, Result, Postponed,
  Void, Walkover, Forfeit*.
- Home team (with its colour) vs away team; score if completed (animated count-up on
  display surfaces); "vs" placeholder otherwise.
- Assigned pitch name (if any); assigned referee name (if any).
- Action buttons (when the card is actionable): **Pitch**, **Ref**, **Status**.

**States.**
- Loading (app-level); error (app-level, retry).
- Tonight empty → floodlights-down + next-up teaser.
- This-week / recent / upcoming empty → quiet muted message each.
- Open issues empty → "Nothing to action."
- Per-fixture conditional affordances: *scheduled/allocated* → can assign pitch, ref, or
  change status; *in progress* → "Live" badge, no actions; *completed* → score shown, can
  still change status (e.g. void); *postponed/void/walkover/forfeit* → outcome shown.

**Interactions.**
- **Pitch** → modal: pick from active pitches (those in maintenance excluded) → assigns.
- **Ref** → modal: pick from active referees → assigns.
- **Status** → modal: choose an allowed transition (postpone / void / walkover / forfeit);
  some require a **winner** or a **reason** field.
- **Approve** registration → approves immediately. **Reject** → modal asking for a reason.
- Sidebar **Add/Edit pitch** → Pitch form (name, surface, capacity, maintenance windows).
- Sidebar **Add/Edit official** → Referee form (name, phone, whatsapp, email, preferred
  channel, employment type, rating 0–5, active toggle).

**Real-time.** Yes — the screen updates live as matches/bookings change (no manual
refresh needed).

---

## Screen 2 — Bookings

**Purpose.** Manage pitch bookings: action incoming requests and view/edit the day's
schedule across pitches; create walk-in bookings.

**Audience / role.** Venue operator. Requires bookings to be **enabled** (a warning banner
with a "Turn on bookings" button shows if disabled).

**Data shown.**
- **Requests inbox (left):** header "Requests" + count. Each request group:
  - Label: **Weekly · N weeks** (a recurring series) or **One-off**.
  - First start time + day-of-week; pitch name.
  - **Confirm** / **Decline** buttons.
  - Empty → "The queue is clear."
- **Schedule (right):**
  - Date navigator: ‹ selected date › with a "Jump to today" affordance.
  - **Desktop:** a multi-pitch **grid** — vertical time axis (hourly ticks), one **column
    per active pitch**, occupancy blocks placed by time. Block types: **fixture** (league
    match — not tappable), **maintenance** (not tappable), **requested booking** (tappable),
    **confirmed booking** (tappable). Tapping an empty slot starts a walk-in at that time.
  - **Mobile:** a single-pitch **day agenda** with pitch-selector buttons instead of the
    grid.

**States.**
- Loading. No active pitches → "Add a pitch in Operations first." Bookings disabled →
  banner + read-only calendar. Requests empty → "queue is clear."

**Interactions.**
- Date ‹ › navigation.
- **Confirm** a request (a series confirms all its occurrences). **Decline** (single
  booking or whole series).
- Tap empty slot → **Walk-in modal**: pitch (required), date (prefilled), time (prefilled),
  length (options come from the pitch's booking windows for that day), and **booked for** —
  toggle between a registered team (picker) or a free-text walk-in name → creates booking.
- Tap a booking block → **Booking detail modal**: shows pitch, when, type (weekly vs
  one-off), status. If *requested* → Confirm / Decline. If *confirmed* → Cancel this
  booking (and "Cancel weekly series" if part of a series).
- **Settings** → **Booking settings modal**: toggle bookings on/off; cancellation policy
  text; per-pitch **booking windows** (day-of-week → open/close time → allowed slot
  lengths); venue-level default **prime-time** windows; per-pitch prime-time overrides.

**Real-time.** Yes — the schedule and request queue update live as bookings change.

---

## Screen 3 — Payments

**Purpose.** Track what's owed and collected; record payments; manage the online pay link.

**Audience / role.** Venue operator (finance).

**Data shown.**
- **Money summary** — four stat cards: **Owed** (£), **Collected** (£), **Outstanding**
  (£), **Collection rate** (%).
- **Online pay link** — if unset: "No online pay link set." If set: the link + **Edit**
  (inline input + Save/Cancel).
- **Charges table** — columns: **Source** (Fixture / Booking, + optional due date),
  **Team**, **Due** (£), **Paid** (£), **Balance** (£), **Status** badge (*Unpaid /
  Part-paid / Paid / Voided*), **Actions**.
  - Filter chips: **All / Unpaid / Part-paid / Paid / Voided**.
  - **Add charge** button.
  - Row actions: **Record payment** (if not fully paid/refunded); **Void** (if not
    refunded).

**States.**
- Loading; error (with Retry). No charges → explanatory empty state. Populated → table.

**Interactions.**
- Filter by status.
- **Record payment** → modal: shows the balance + team; amount (£), method (**Cash / Bank
  transfer / Card / Other**), optional note → records.
- **Add charge** → modal: pick a fixture, pick the team (home or away of that fixture),
  amount (£, blank = league default) → creates.
- **Void** → confirm → voids.

**Real-time.** No live subscription; manual refresh button in the header.

---

## Screen 4 — Teams

**Purpose.** Directory of teams active in the venue's competitions; drill into a roster.

**Audience / role.** Venue operator.

**Data shown.**
- Header: "{N} teams across active competitions" + a search box.
- **Team cards** (grid): a generated crest (from the team's two colours + initials), the
  team name, "{N} competitions", and a "last active" relative time (today / Xd / Xw / Xmo).
- **Team detail** (modal): crest + name + active competitions (chips) + player count, and a
  **roster table**: shirt number · name (+ nickname + badges: VC / Reserve / Injured /
  Inactive) · stats (Goals, POTM, Appearances, W-D-L). Inactive players are visually
  de-emphasised.

**States.**
- Loading; error. No teams → "Teams appear here once approved into a competition." Search
  with no match → "No teams match."

**Interactions.** Search filters by name. Click a card → opens the team detail modal.

**Real-time.** No.

> Note: "POTM" = Player of the Match. Always shown as **POTM** (never "MOTM").

---

## Screen 5 — Players

**Purpose.** Aggregate directory of every player across all the venue's teams.

**Audience / role.** Venue operator.

**Data shown.**
- Header: "{N} active players across your teams" + filter buttons (**All / Injured /
  Inactive**) + search box.
- A single table: shirt · name (+ nickname + injured/inactive badges) · team (with the
  team's colour) · stats (Goals, POTM, Appearances). Inactive rows de-emphasised.

**States.** Loading; error. No players → empty state. Filter/search no match → "No players
match."

**Interactions.** Filter by status; search by player name, nickname, or team name.

**Real-time.** No.

---

## Screen 6 — Staff

**Purpose.** Manage both match officials (referees) and venue staff (reception, managers,
groundstaff, etc.).

**Audience / role.** Venue operator / admin.

**Data shown.**
- **Match officials** section: "{N} officials" + **Add official**. Cards (active first):
  avatar (initials), name, employment type + rating, contact chips (preferred channel,
  phone, email), "Inactive" badge if retired.
- **Venue staff** section: "{N} venue staff" + **Add staff**. Cards (active first): avatar,
  name, **role** (Reception / Manager / Admin / Groundstaff / Coach / Staff) + notes,
  contact chips, "Inactive" badge.

**States.** Loading. No officials / no staff → distinct empty states. Error (staff list).

**Interactions.**
- **Add / click official** → Referee form (name, phone, whatsapp, email, preferred
  channel, employment type, rating, active).
- **Add / click staff** → Staff form (name, role, email, phone, whatsapp, preferred
  channel, notes, active).

**Real-time.** No.

---

## Screen 7 — League

**Purpose.** Read-only overview of the venue's leagues, their seasons, and competitions.
(Creating a season happens through the Season Wizard, Screen 11.)

**Audience / role.** Venue operator.

**Data shown.**
- Header: "Leagues" + "{N} leagues · {N} seasons" + **Set up new season** button.
- Per league: name, short name, format, day-of-week, default kickoff time, standings
  visibility (public/private), league code. Then its seasons — each with name, date range
  + week count, and its competitions as chips with a status badge. "No seasons yet" if empty.

**States.** No leagues → "No leagues configured yet." Otherwise the card list.

**Interactions.** **Set up new season** → opens the Season Wizard (Screen 11).

**Real-time.** No.

---

## Screen 8 — Table (standings)

**Purpose.** Live league standings for round-robin competitions.

**Audience / role.** Venue operator / league management.

**Data shown.**
- Header: "League Table · updates as results come in." A competition dropdown if more than
  one round-robin competition exists.
- Table columns: **#** (rank) · **Team** (with colour) · **P** · **W** · **D** · **L** ·
  **GF** · **GA** (GA may hide on mobile) · **GD** (colour-coded +/−/0) · **Pts** (bold).
  Top 3 rows visually highlighted.

**States.** No round-robin competition → empty state. Loading; error. No teams yet → empty.

**Interactions.** Switch competition via the dropdown.

**Real-time.** Updates as results come in.

---

## Screen 9 — Cups (only if a cup/group competition exists)

**Purpose.** Manage knockout brackets and group stages; schedule ties; seed knockouts from
groups.

**Audience / role.** Venue operator.

**Data shown.**
- Header: "Cups" + a cup selector (if more than one). A **champion banner** when decided.
- **Group stage** (if applicable): a grid of group mini-tables (Team · P · W · D · L · GD ·
  Pts), with qualifying teams marked. A **Build knockout** button (enabled only once all
  group fixtures are played).
- **Single-elimination bracket**: rounds laid left→right (Round 1 → Final). Each **tie**
  card shows home/away team (or "bye"/"TBD") with scores if decided, and meta: a decider
  tag (penalties / extra time / walkover / forfeit / full time) when decided, a date+time
  tag when scheduled, or a **Schedule** button when ready.

**States.** Loading; error. No cups → empty state. Group stage incomplete → message
explaining the knockout seeds once all groups finish.

**Interactions.**
- Select cup.
- **Schedule** a ready tie → modal (date + kickoff + optional pitch).
- **Build knockout** → modal (date + kickoff + optional pitch) → seeds the bracket from
  group results.

**Real-time.** No (manual refresh).

---

## Screen 10 — Reception Display Settings (modal from header)

**Purpose.** Configure the public TV board (Display app): which panels show, how they
rotate, an optional screen PIN, and a custom message.

**Audience / role.** Venue admin / manager.

**Data shown & interactions.**
- **Display screen link** — read-only URL + Copy button (the link a TV opens).
- **Screen PIN** — shows whether a PIN is set; an input to set/change it (4–8 digits); a
  "Remove PIN" option when one exists; blank = keep current.
- **Panels** — the full list of zones (live scores, standings, top scorers, upcoming,
  recent, goals ticker, custom message), each with an enable toggle and **drag/▲▼ reorder**
  for the enabled ones.
- **Auto-cycling mode** — dropdown: **Smart** (big scores during live games, fixtures/
  results between) / **Cycle** (rotate on a timer) / **Fixed** (never rotate). Plus "Cycle
  every" seconds (10–60).
- **Custom message** — free-text shown on the idle TV screen.
- **Save** → persists; show a "Saved ✓" confirmation. Saving state.

**Real-time.** N/A (settings form).

---

## Screen 11 — Season Wizard (5-step modal)

**Purpose.** Create a season, define its competitions, assign teams, preview the generated
fixtures, and commit.

**Audience / role.** Venue admin / league manager.

**Steps (each with Back/Next; Next disabled until valid).**
1. **Basics** — pick league; season name; start/end dates; number of weeks; default
   kickoff; weeks to exclude; double-round toggle; multi-select which pitches are available.
2. **Competitions** — add/edit/remove competitions; each has a name, type (**league** or
   **cup**), and format (**round_robin / single_elimination / group_stage**); group stage
   also needs number of groups + qualifiers per group.
3. **Teams** — for each competition, select participating teams from the venue's active
   teams.
4. **Preview** — a generated fixture preview per competition: rounds, matches per round,
   total fixtures; a **Regenerate** affordance if earlier settings change.
5. **Confirm** — final review → **Create season** (generates and persists everything).

**States.** Per-step validation; an error state inside the modal (can go Back or close).

**Real-time.** N/A.

---

## Data contract appendix

These are the shapes the screens render. Field names are what your components should expect
as props. (`?` = sometimes absent. Money is in **pence** as integers — format to £.)

**Venue state** (feeds the whole shell + most tabs):
```
venue: {
  name, bookings_enabled (bool), payment_link?, cancellation_policy?,
  display_token, display_pin (bool: set or not), display_config { … see Display brief },
  default_prime_time_windows?
}
leagues: [{ id, name, short_name, format, day_of_week, default_kickoff_time,
            standings_visibility ('public'|'private'), league_code }]
seasons: [{ id, league_id, name, start_date, end_date, num_weeks, status }]
competitions: [{ id, season_id, name, type ('league'|'cup'),
                 format ('round_robin'|'single_elimination'|'group_stage'),
                 num_groups?, qualifiers_per_group? }]
fixtures: {
  tonight: [Fixture], this_week: [Fixture], upcoming: [Fixture], recent: [Fixture]
}
teams: { [team_id]: { id, name, primary_colour, secondary_colour } }
pitches: [{ id, name, active (bool), is_available (bool), surface, capacity,
            sort_order, maintenance_windows, booking_windows, prime_time_windows }]
refs: [{ id, name, phone?, email?, whatsapp_number?, preferred_channel,
         employment_type ('freelance'|'in_house'), overall_rating, active (bool) }]
pending_registrations: [{ id, team_id, team_name }]
open_incidents: [{ id, severity ('critical'|'warning'|'info'), description }]

Fixture = {
  id, home_team_id, away_team_id, playing_area_id?, official_id?,
  scheduled_date, kickoff_time,
  status ('scheduled'|'allocated'|'in_progress'|'completed'|'postponed'|'void'|'walkover'|'forfeit'),
  home_score?, away_score?, walkover_winner_id?, forfeit_winner_id?, decided_by?,
  round_name?
}
```

**Bookings / occupancy** (Bookings tab): an array of occupancy blocks —
```
{ source_kind ('fixture'|'maintenance'|'booking'),
  pitch_id, starts_at, ends_at,
  detail: { status? ('requested'|'confirmed'), series_id?, team_name?, … } }
```
Pending requests are the `booking` blocks with `detail.status='requested'`, grouped by
`series_id` (a recurring block) or individually (one-offs).

**Charges** (Payments — from a charges fetch):
```
summary: { owed_pence, collected_pence, outstanding_pence, collection_rate }
charges: [{ id, source ('fixture'|'booking'), team_name?, due_date?,
            amount_due_pence, paid_pence, balance_pence,
            status ('unpaid'|'part_paid'|'paid'|'voided'|'refunded') }]
```

**Teams directory** (Teams tab):
```
[{ team_id, name, primary_colour, secondary_colour,
   competition_count, last_active_at }]
```
**Team roster** (team detail modal):
```
team: { name, primary_colour, secondary_colour }
competitions: [{ name }]
players: [{ shirt_number?, name, nickname?, is_vc?, is_reserve?, injured?, disabled?,
            goals, motm (POTM count), attended (appearances), w, d, l }]
```

**Players directory** (Players tab):
```
[{ id, team_id, team_name, team_colour, name, nickname?, shirt_number?,
   goals, motm, attended, injured (bool), disabled (bool) }]
```

**Venue staff** (Staff tab — referees come from `refs` above):
```
[{ id, name, role ('reception'|'manager'|'admin'|'groundstaff'|'coach'|'staff'),
   email?, phone?, whatsapp_number?, preferred_channel, notes?, active (bool) }]
```

**Standings** (Table tab):
```
[{ rank, team_id, team_name, primary_colour, played, w, d, l, gf, ga, gd, pts }]
```

**Cup bracket / groups** (Cups tab):
```
bracket: { rounds: [{ round_number, round_name,
            ties: [{ id, status ('ready'|'scheduled'|'decided'|...),
                     home_team_name?, away_team_name?, home_score?, away_score?,
                     scheduled_date?, kickoff_time?, decided_by? }] }],
           champion?: { name }, all_groups_complete (bool), knockout_seeded (bool) }
groups: { groups: [{ group_label,
            standings: [{ team_id, team_name, qualifying (bool), played, w, d, l, gd, pts }] }] }
```
