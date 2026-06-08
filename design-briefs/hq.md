# HQ Dashboard — Functional Brief

> Read `README.md` first. This brief is functional only — no style direction. Use the
> field names from the **Data contract appendix** at the bottom; design every state.

---

## Surface header

**Product context.** HQ is the head-office view for a **company that operates several
venues**. Where the Venue dashboard runs one venue's night, HQ watches the whole estate:
which venues are healthy, what needs attention, live activity across all sites, money owed
and collected, and pitch utilisation. It's a monitoring + management cockpit, not a
data-entry tool.

**Who uses it + device.** Head-office admins of a multi-venue company. Primarily **desktop**
(it's analytics-dense), but should degrade gracefully to a single column on smaller screens.

**Auth / launch.** Sign in with **Google** (OAuth). Access is granted by being on a
company's admin roster. A user can belong to **more than one company** (a company switcher
appears). Each admin has a **role** that gates some controls (below). Design the
**signed-out / sign-in** screen and an **access-denied** state (signed in, but on no
company).

**Roles.**
- **super_admin** — full control: resolve incidents, generate shareable preview links.
- **analyst** — read-only (no resolve, no preview generation).
- **regional_admin** — scoped to a region; sees only that region's venues. (Scoping is
  applied to the data before it reaches the UI; from a design standpoint, treat it as
  "fewer venues in the list." The user's role is shown as a badge.)

**App shell.**
- **Top bar**: brand "IN OR OUT HQ", the company name, the user's **role badge**, a
  **company switcher** (hidden if only one company), a **Share preview** button
  (super_admin only), the user's email, and **Sign out**. When a preview link is generated,
  a dismissible banner shows it with a copy button.
- **Tab nav**: `Dashboard · Utilisation · Analytics`.
- **Global states**: loading, error, access-denied.

---

## Screen 1 — Dashboard (default)

**Purpose.** The live cockpit: every venue's health at a glance, a drill-down on any one
venue, and a running feed of what's happening across the estate right now.

**Audience / role.** All HQ admins. One action (resolving an incident) is gated to
non-analyst roles.

**Layout.** Three columns: **Venue Health Grid** (left), a context panel in the **centre**
that is either the live **Activity Feed** (default) or a selected **Venue Detail**, and
**Alerts & Actions** (right). On narrow screens these stack into one column.

### 1a — Venue Health Grid (left column)

**Data shown.**
- **Company summary** — four chips: venue count, active leagues, registered teams, open
  incidents (total).
- **Venue health cards** (one per venue, clickable): a **status dot** (green / amber /
  red), venue name, an optional health **score** (/100), a **subscription** badge (active /
  trial / expired), an optional health **reason** line, an optional **region** label, and a
  stat row: tonight's fixtures, open incidents, a "no pitch" warning if any fixtures this
  week are unallocated, a "no ref" warning if any are unassigned.

**States.** Loading; empty ("No venues in scope."); populated. The selected venue's card is
highlighted.

**Interactions.** Click a card → loads that venue into the centre **Venue Detail** panel.

**Real-time.** Refreshes as company state updates.

### 1b — Venue Detail (centre, when a venue is selected)

**Purpose.** Everything about one venue: incidents to action, its fixtures, its leagues.

**Data shown.**
- Header: venue name; meta line (region · subscription · pending registrations count).
- **Open incidents**: each card has a **severity** badge (critical / warning / info),
  description, created timestamp, and a **Resolve** button (hidden for analysts). Resolve
  expands an optional **note** field + Confirm/Cancel.
- **Tonight's fixtures**: home v away, score if final or kickoff time if pending, plus
  "no pitch" / "no ref" warnings.
- **This week's fixtures**: same, without scores.
- **Recent results**: same, with scores.
- **Leagues**: each league name with an active/inactive badge.

**States.** No selection → a "Select a venue" placeholder in this panel. Loading ("Loading
venue…"). Populated. Resolve error shows inline (form stays open). A **Back** control
returns the centre panel to the Activity Feed.

**Interactions.** **Resolve incident** → optional note → Confirm → the incident clears and
the venue + company data refresh. **Back** → clears the selection.

**Real-time.** Refreshes after a resolve; otherwise static until reselected.

### 1c — Activity Feed (centre, when no venue is selected)

**Purpose.** A live ticker of what's happening across all the company's venues right now.

**Data shown.**
- **Live now / Upcoming** — if any matches are live, a "Live now" list; otherwise an
  "Upcoming" list. Each item: home v away, a live score or a status badge (e.g. "15:00",
  "LIVE", "Postponed"), the venue name + date + kickoff.
- **Goals** — a list of recent goals: ⚽ player (team) · venue · minute.

**States.** Loading ("Loading live feed…"); empty ("No fixtures scheduled."); populated;
error banner.

**Interactions.** Read-only.

**Real-time.** **Yes** — polls every ~30s and also updates instantly when any venue
broadcasts a change. This is the most "alive" panel; design it to update gracefully.

### 1d — Alerts & Actions (right column)

**Data shown.**
- **Needs attention** — only the venues that aren't fully healthy (non-green health, or any
  open incidents, or unallocated pitches, or unassigned refs). Each: status dot, venue name,
  and the relevant counts ("X critical", "X open", "X no pitch", "X no ref").
- **Billing** — only venues whose subscription isn't active: venue name, a trial/expired
  badge, and a trial-end date where relevant.

**States.** Attention empty → "All venues healthy 🎉". Billing empty → "All subscriptions
active." Populated → card lists.

**Interactions.** Click a "needs attention" venue → drills into its Venue Detail (centre).
Billing list is read-only.

**Real-time.** Updates with company state.

---

## Screen 2 — Utilisation

**Purpose.** How well pitch time is being used across the estate — overall, in prime time,
off-peak, and where the empty hours are.

**Audience / role.** All HQ admins.

**Data shown.**
- **Summary header**: the date range (from → to · N days); chips for overall used %, prime
  used %, off-peak used %, empty prime hours (highlighted if > 0), used-of-available hours,
  busiest slot (day/time · %), quietest slot, and requested (pending) hours. A horizontal
  **fill bar** visualising overall utilisation.
- **Warnings** (conditional): a note if no pitch has prime-time configured; a note if some
  pitches have no booking hours set (their availability is assumed).
- **By-venue table** (expandable rows). Collapsed row: venue name + region badge, overall %,
  prime %, off-peak %, empty prime hours, used hours, busiest slot. Expanded row reveals a
  **per-pitch** sub-table (pitch name, overall/prime/off-peak %, empty prime hours, used
  hours, and a fixture-hours vs booking-hours split) plus best day / worst day / quietest
  slot / requested hours.

**States.** Loading ("Loading utilisation…"); empty ("No venues with measurable utilisation
in this range."); populated; error.

**Interactions.** Click a venue row → expand/collapse its per-pitch detail. (Date range is
the dashboard-level range.)

**Real-time.** No (snapshot).

---

## Screen 3 — Analytics

**Purpose.** A configurable analytics board the admin tailors to what they care about.

**Audience / role.** All HQ admins.

**Data shown — a grid of cards** the admin can choose and reorder. Available cards:
- **Overview** — 8 chips: venues, leagues, seasons, teams, fixtures completed, fixtures
  remaining, total goals, average goals per game.
- **Venue comparison** — table: venue, region, leagues, teams, played/total, completion %,
  open incidents.
- **Top scorers** — table: rank, player, team, venue, goals.
- **Discipline** — table: player, team, yellow cards, red cards.
- **Incidents** — chips: critical / warning / info counts.
- **Billing** — chips: subscription-status breakdown by count.
- **Revenue** — table + chips: owed / collected / outstanding (£), collection rate %, and a
  per-venue breakdown with region.
- **Utilisation** — a compact embed of the utilisation summary.

There are three starting presets the admin can pick from: **Operations** (overview,
comparison, incidents), **Commercial** (overview, revenue, billing, comparison),
**Performance** (overview, top scorers, discipline).

**States.** Loading ("Loading analytics…"); populated grid; **edit mode** (see below);
edit-mode empty ("No cards selected. Add some above."); error.

**Interactions.**
- **Customise dashboard** → edit mode: choose a preset, toggle individual cards on/off,
  reorder cards (▲/▼), remove a card. **Save** persists the layout; **Cancel** discards.

**Real-time.** No (snapshot for the selected date range).

---

## Screen 4 — Public Preview (anonymous, no sign-in)

**Purpose.** A time-limited, read-only snapshot a super_admin can share with a prospective
client — and an upsell to the full signed-in HQ.

**Audience / role.** Anyone with a valid preview link (no login). The link is generated by
a super_admin from the top bar.

**Data shown.**
- A watermark/banner: "PREVIEW — upgrade to the HQ tier for permanent, live access."
- Company name; "Read-only snapshot · expires {date}".
- Four summary chips: venues, leagues, teams, fixtures completed.
- **Venue health cards** (read-only, not clickable): status dot, venue name, subscription
  badge, region, tonight's fixtures + open incidents.
- A footer **upsell**: a short pitch ("the live HQ does more") with bullets — revenue &
  collection, utilisation, health scores, live alerts — and a call to ask for permanent
  signed-in access.

**States.** Loading ("Loading preview…"); error ("This preview link has expired or is
invalid."); populated.

**Interactions.** Read-only. No drill-down.

**Real-time.** No.

---

## Data contract appendix

Field names are what your components should expect as props. Money is in **pence** (integers
— format to £).

**Identity / roles** (drives the shell):
```
{ signed_in (bool), email,
  companies: [{ company_id, name, role ('super_admin'|'analyst'|'regional_admin') }] }
```

**Company state** (Venue Health Grid + Alerts & Actions):
```
company: { name }
summary: { venue_count, active_leagues, registered_teams, open_incidents }
caller: { role }
venues: [{
  id, name, region?,
  health ('green'|'amber'|'red'), health_score? (/100), health_reason?,
  subscription_status ('active'|'trial'|'expired'), trial_end_date?,
  tonight_fixtures, open_incidents, critical_incidents,
  unallocated_this_week, unassigned_refs_this_week
}]
```

**Venue detail** (centre panel):
```
venue: { name, region?, subscription_status }
pending_registrations: (number)
open_incidents: [{ id, severity ('critical'|'warning'|'info'), description, created_at }]
fixtures_tonight: [{ id, home, away, home_score?, away_score?, kickoff_time,
                     pitch_allocated (bool), ref_assigned (bool) }]
fixtures_this_week: [ …same shape, no scores ]
fixtures_recent: [{ id, home, away, home_score, away_score, status }]
leagues: [{ id, name, active (bool) }]
```

**Activity feed** (live ticker):
```
live:     [{ fixture_id, home, away, home_score, away_score, venue, date, kickoff_time, status }]
upcoming: [{ fixture_id, home, away, venue, date, kickoff_time, status }]
goals:    [{ player, team, venue, minute }]
```

**Utilisation:**
```
range: { from, to, days }
assumptions: { assumed_pitches }
company: { overall_pct, prime_pct, offpeak_pct, prime_configured (bool),
           empty_prime_hours, used_hours, available_hours, requested_hours,
           best_slot: { slot, pct }, worst_slot: { slot, pct } }
venues: [{ venue_id, venue_name, region?, overall_pct, prime_pct, offpeak_pct,
           prime_configured (bool), empty_prime_hours, used_hours, requested_hours,
           best_day: { day, pct }, worst_day, best_slot, worst_slot,
           pitches: [{ pitch_id, pitch_name, overall_pct, prime_pct, offpeak_pct,
                       empty_prime_hours, used_hours, assumed_availability (bool),
                       source_split: { fixture_hours, booking_hours } }] }]
```

**Analytics:**
```
config: { preset?, cards: [card_key, …] }
analytics: {
  overview: { venues, leagues, seasons, teams, fixtures_completed, fixtures_remaining,
              total_goals, avg_goals_per_game },
  venue_comparison: [{ venue, region, leagues, teams, played, total, completion_pct,
                       open_incidents }],
  top_scorers: [{ rank, player, team, venue, goals }],
  discipline: [{ player, team, yellow_cards, red_cards }],
  incidents: { critical, warning, info },
  billing: { active, trial, expired },
  revenue: { owed_pence, collected_pence, outstanding_pence, collection_rate,
             by_venue: [{ venue, region, owed_pence, collected_pence,
                          outstanding_pence, collection_rate }] }
}
```
Card keys: `overview, venue_comparison, top_scorers, discipline, incidents, billing,
revenue, utilisation`.

**Public preview:**
```
company: { name }
summary: { venue_count, active_leagues, registered_teams, fixtures_completed }
venues: [{ name, health, subscription_status, region?, tonight_fixtures, open_incidents }]
expires_at
```
