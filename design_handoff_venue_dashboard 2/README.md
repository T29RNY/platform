# Handoff — Venue Dashboard

> **Note for the implementer**
>
> The files in this bundle are **design references** built in HTML / JSX with React + Babel via CDN.
> They are not production code to ship as-is. Your job is to **recreate this design in the target
> codebase's environment** (per the brief: **Vite + React + plain CSS**, no Tailwind / no component
> library) using its own patterns and conventions.
>
> Treat this bundle as a high-fidelity reference for layout, interactions, copy, and data shape —
> not as a code dump to lift.

---

## Overview

The Venue Dashboard is the operator console for a single sports venue running amateur/recreational
football leagues. One operator (sometimes a small team) uses it to run the night: see tonight's
matches, assign pitches and referees, confirm bookings, take payments, manage teams/players/staff,
set up seasons, configure the reception TV, and handle customer relationships.

The product is **In or Out** (IoO). This is one of four surfaces in the wider platform — the
others (Display, League, HQ) are out of scope for this bundle.

## Fidelity

**High-fidelity (hi-fi).** All colours, spacing, typography, radius, shadows, and interaction
patterns are intentional and should be preserved. The visual direction is "modern dark operator
dashboard" — dark navy/black surfaces, rounded 14–16px cards, Manrope sans throughout, sodium-amber
(#FFC83A) accent, soft red/green/blue for status colours, generous padding. Designed primarily for
desktop; light mode is included as an alternate.

A second prototype (`prototype_v1_editorial_reference.html`) preserves an earlier "editorial /
operator console" direction that was rejected by the client in favour of this one. Keep for
reference; do not implement.

## Audience & Device

- One venue operator, sometimes a small team
- Primarily **desktop in the office**, but the brief specifies mobile must work too
- Used **one-handed pitchside on a phone** for the Operations tab (this bundle prioritises
  desktop; a mobile pass is a known unfinished item)
- Used during stressful live-match nights, so visual hierarchy emphasises what needs action right
  now (live status, "to assign", "open issues")

## Auth / Launch

The operator opens a private link containing a venue **admin token** (in the URL — either
`?token=…` or `/venue/<token>`). No username/password. The prototype includes:

- **Token-entry form** — when no token is in the URL
- **Loading state** — while the venue state is being fetched
- **Error state** — token invalid / expired (with a Retry)

These are in `src/modals_misc.jsx` (`TokenEntry`, `GlobalLoading`, `GlobalError`). They are not
currently routed; toggle them via the Tweaks panel "State" radio.

---

## Stack assumed by the brief

- **Vite + React + plain CSS** (CSS files + CSS custom properties)
- **No Tailwind, no component library**
- Components are **prop-driven and presentational** — no fetch, no API calls, no auth
- Every component takes its data as props whose names match the data contract in the original
  surface brief (kept intact in this prototype where possible)

## What this prototype does and doesn't have

| Has | Does not have |
|---|---|
| Every screen designed (10 tabs + their modals) | Real API / websocket plumbing |
| Every state covered (loading / empty / error / populated / stress-tested with 0–6 live matches) | Routing — single SPA, no URL state |
| Real data shapes following the brief's field names | Mobile-optimised Operations layout |
| Sodium-amber accent + dark/light themes | i18n / RTL |
| Search palette (⌘K) and notifications dropdown | Sound / alert audio |
| Notification "seen" state persisted to localStorage | Print / PDF export |
| Cancellation flow with policy-driven refund decisions | Backend integrations (deliberately out of scope per brief) |

---

## File map

```
prototype.html                          ← entry; loads React+Babel CDN, then each .jsx file in order
prototype_v1_editorial_reference.html   ← rejected v1 direction, keep for reference only
tweaks-panel.jsx                        ← prototype-only tweak panel host shell; STRIP from production
src/
  styles2.css                           ← all styles. The "2" suffix is a leftover cache-bust filename
  styles.v1.css                         ← v1 styles for the rejected direction
  data.jsx                              ← sample data fixtures + a few helper fns (getInitials, poundsFromPence,
                                          shortDate, relativeFrom). REPLACE with your data layer.
  components.jsx                        ← shared atoms: Crest, FixtureCard, FixtureCompact, Modal, StatusPill,
                                          SectionHead, EmptyState, StarRating
  app.jsx                               ← App shell: rail nav, top bar, Icon registry, root <App>,
                                          Tweaks default values
  operations.jsx                        ← Operations screen + pickers (Pitch/Ref/Status), Reject reg, Pitch
                                          form, Ref form
  bookings.jsx                          ← Bookings: Requests grid, Schedule grid, Cancellations list,
                                          New booking modal (block bookings), Cancel booking modal
                                          (policy-driven refund), Settings modal
  directories.jsx                       ← Payments, Teams, Players, Staff screens + their modals
  customers.jsx                         ← Customers tab (IoO app users) + detail modal + Nudge modal
  league_table_cups.jsx                 ← League overview, Standings table, Cups (groups + bracket)
  modals_misc.jsx                       ← DisplaySettingsModal, SeasonWizardModal (5-step), TokenEntry,
                                          GlobalLoading, GlobalError
  topbar_overlays.jsx                   ← SearchPalette (⌘K), NotificationsPanel (bell dropdown)
```

---

## Screens

The rail navigation groups screens as **Workspace · Directory · Competition**, plus footer
actions for **Reception display** and **Season setup**.

### 1. Operations (default)

**Purpose:** at-a-glance command of tonight's matches, the rest of the week, recent results, and
anything needing action.

**Layout (desktop):**
- Stat row (4 tiles spanning full width): Tonight · To assign · Issues · Outstanding (click =
  scroll-to / tab-switch destination, with an amber arrow chip on hover)
- Two-column main grid: left column has Tonight, Open issues, This week, then two-column
  Recent / Upcoming; right column has Pitches sidebar + Officials sidebar
- At < 1280px the right column stacks below the main content

**Components:**
- `FixtureCard` — dark card with team crests (initials over a diagonal-split colour gradient
  from the team's `primary_colour` + `secondary_colour`), tabular scoreboard score, live progress
  bar (red, animated for `in_progress`), pitch + whistle icons in the footer with assigned
  pitch/ref or amber "Pitch?/Ref?" callouts, action buttons (Pitch, Ref, •••)
- `FixtureCompact` — list row for Recent/Upcoming with time pill + matchup + score
- Open issues card — registration approvals (Approve / Reject), incidents (critical / warning /
  info severity colours)
- Pitch sidebar card — list of pitches with status pip (green=active, amber=maintenance, grey=retired)
- Officials sidebar card — list with employment type, rating, retired badge

**Status pills** (`StatusPill` in `components.jsx`):
- Live (red, pulsing dot, `pill-live`)
- All set (`pill-muted`)
- Needs pitch / Needs ref / Walkover / Forfeit (`pill-warn`)
- Result (`pill-ok`)
- Postponed / Void (`pill-muted`)

### 2. Bookings

**Purpose:** action booking requests, view the schedule across pitches, manage cancellations.

**Layout (top to bottom):**
1. **Requests** — grid of cards (3–4 columns depending on viewport) showing the booker, type
   (Weekly · N wks / One-off), pitch, date+time+duration, note quote, Confirm / Decline buttons,
   contact-channel icon. Max **2 rows** by default with **View N more** to expand.
2. **Schedule** — multi-pitch grid with hourly time axis (17:00–23:00). Block types: fixture
   (amber), maintenance (hatched dashed), confirmed booking (green), requested booking (amber).
   Click empty slot = New booking modal pre-filled with that pitch+time; click block = Booking
   detail modal.
3. **Cancellations** — searchable/filterable audit log: text search, pitch dropdown, outcome
   dropdown, period chips (Today / 7d / 30d / All), Export CSV button. Each row: when + cancelled
   by · booker · booking time + pitch · reason + note · outcome pill + £ amounts + notification
   status.

**Modals:**
- **New booking** (`WalkinModal`) — Repeat: One-off / **Weekly block** with weeks count + skip
  dates + occurrence preview chips ("Mon 8 Jun, Mon 15 Jun, …"). Pitch, date, time, length
  (preset buttons 30/45/60/90/120m), Booked for: Registered team / Walk-in external.
- **Booking detail** — pitch, when, type, status, booked for. Footer changes based on status
  (requested → Confirm/Decline; confirmed → Cancel this booking / Cancel weekly series).
- **Cancel booking** — summary of what's being cancelled, **policy banner** (green if ≥48h notice,
  amber "Short notice" if <48h, computed from `cancellation_policy` and the booking time), reason
  category chips, optional note, **Charge decision** (three tiles: Full refund / 50% credit /
  No refund) defaulting to Full refund if within policy or 50% credit if outside, with override
  hint, Notify-booker toggle.
- **Settings** (`BookingSettingsModal`) — bookings on/off toggle, cancellation policy text,
  per-pitch booking windows, default prime-time windows.

### 3. Payments

**Purpose:** track owed/collected/outstanding, record payments, manage online pay link.

**Layout:**
- Four stat cards: Owed / Collected / Outstanding / Collection rate (with a progress bar)
- Online pay link row — `pay.ioo.fc/<slug>`, Edit inline
- Charges table — Source · Team · Due / Paid / Balance · Status pill · Actions (Record payment /
  Void). Filter chips: All / Unpaid / Part-paid / Paid / Voided.

**Modals:** Record payment (amount + method: Cash / Bank transfer / Card / Other + note), Add
charge (fixture + team + amount), Void confirmation.

### 4. Customers (new — added during this design)

**Purpose:** every group or individual using the IoO app to book pitch time. Different from
Teams: a Customer has app `admins` and `vcs` (same rights), a `bookings_count`, a `nudge_status`
(healthy / low_ins / dormant / new), and an `avg_ins` against a `target_ins`.

**Layout:**
- Header with count + dormant/low-ins alert pill + Invite customer
- Search across customer name + app user names + notes
- Filter chips: kind (All / Groups / Individuals), status (Any / Healthy / Low ins / Dormant /
  New)
- Grid of customer cards (3 cols at desktop, 2 at medium, 1 at narrow)

**Customer card:** crest (gradient + initials), name, "N admins/VCs" or "Individual booker",
status pill, three stats (Bookings · Avg ins / target with coloured bar · Total spend), stacked
avatar chips for app users, "Active Nh ago".

**Customer detail modal:** header (crest, name, joined/active, notes block, three stat tiles),
**App admins & VCs** grid with role pills + contact channels, **Upcoming bookings** list (each
row: date + time, pitch + source pill Casual/League, opponent for league fixtures, **live ins
count** with coloured progress bar, status pill), **Recent** list below dimmed.

Footer actions: **+ New booking** (deep-link to New booking with this customer prefilled),
**Nudge via {channel}** (opens Nudge modal).

**Nudge modal:** recipient (the customer's admin) + template chips that **change based on
nudge_status**:
- `dormant` → "Win them back" / "Discount offer"
- `low_ins` → "Heads up on ins" / "Offer to release"
- `new` → "Welcome"
- `healthy` → "Friendly check-in" / "Offer regular slot"

Templates auto-populate the admin's first name + customer name + relevant booking dates. Editable
preview. Channel pre-set to the admin's preferred. Log-in-history toggle on by default.

### 5. Teams

Grid of cards (registered competition teams), with a search and a roster detail modal showing
shirt number, name (+ nickname + badges: VC / Reserve / Injured / Inactive), goals, POTM,
appearances, W-D-L. Inactive players visually de-emphasised.

### 6. Players

Aggregate directory across all teams. Filter chips (All / Injured / Inactive), search, single
table.

### 7. Staff

Two sections: Match officials (referees — name, employment type, rating, contact chips, active
toggle) and Venue staff (reception/manager/admin/groundstaff/coach/staff). Both have add/edit
forms.

### 8. Leagues

Read-only overview. Per league: name, short name, format, day, kickoff, public/private
visibility, league code, then its seasons. Each season has name, date range + weeks, status,
competitions as chips with type-coloured dots. **+ Set up new season** button opens the 5-step
Season Wizard.

### 9. Table (Standings)

12-row table with rank · team (with colour bar) · P / W / D / L / GF / GA / GD (color-coded
+/-/0) / Pts. Top 3 rows highlighted (amber rank badge).

### 10. Cups

Champion banner if decided. Group-stage mini-tables in a grid (qualifying teams marked Q),
**Build knockout** button enabled when all groups complete. Knockout bracket: rounds left→right,
each tie shows home/away/score, decider tag (FT/AET/Pens), date+time when scheduled, "Schedule"
button when ready.

---

## Modal patterns

All modals share `Modal` in `components.jsx`: overlay with 0.5 alpha black + 6px backdrop blur,
centered card with 20px radius, animated entrance, header / body / optional footer. Three widths:
default 560px, `wide` 880px, `xwide` 1080px. Esc closes; clicking the overlay closes.

The big ones to copy carefully:
- **Cancel booking** — best example of a policy-driven decision UI
- **Season Wizard** — 5-step modal with Back/Next, validation per step, regenerate affordance,
  occurrence preview
- **Nudge** — template chips driving textarea content, with channel awareness
- **Display settings** — drag/▲▼ reorder of panel list + cycle-seconds slider that only appears
  on `mode === 'cycle'`

---

## Design tokens

All defined as CSS custom properties on `:root` in `src/styles2.css` (dark default, light via
`[data-theme="light"]`). The Tweaks panel toggles `data-theme`, `data-density`, `data-type`, and
the `--accent` variable directly.

### Colours (dark mode default)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0A0D14` | Page background |
| `--bg-2` | `#11151F` | Card surface |
| `--bg-3` | `#181D2A` | Elevated / hover surface |
| `--bg-4` | `#232938` | Deeper hover / input track |
| `--ink` | `#F2F4F8` | Primary text |
| `--ink-2` | `#B9C0CC` | Secondary text |
| `--ink-3` | `#7E8696` | Tertiary text / labels |
| `--ink-4` | `#555C6B` | Disabled / placeholder |
| `--border` | `rgba(255,255,255,0.06)` | Default border |
| `--border-strong` | `rgba(255,255,255,0.12)` | Active / hover border |
| `--accent` | `#FFC83A` | Sodium-amber accent |
| `--accent-soft` | `rgba(255,200,58,0.14)` | Accent backgrounds |
| `--live` | `#F04438` | Live red |
| `--ok` | `#12B981` | Success green |
| `--warn` | `#F59E0B` | Warning amber |
| `--info` | `#3B82F6` | Info blue |

Light mode swaps these to white-on-near-black equivalents (see `[data-theme="light"]` block).

### Typography

- **Sans:** Manrope (weights 400/500/600/700/800), loaded from Google Fonts
- **Display:** Manrope (used at 22–28px for h1/h2)
- **Alternatives in Tweak:** DM Sans (humanist), Fraunces (editorial display headings)
- Tabular numerals via `font-variant-numeric: tabular-nums` on all numeric displays (scores,
  stats, currency)
- Letter-spacing: `-0.02em` to `-0.025em` on display text, default elsewhere
- **No monospace** — earlier v1 used JetBrains Mono for timestamps; v2 dropped it entirely

### Radius scale

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `8px` | Small chips, badges |
| `--radius` | `10px` | Inputs, buttons |
| `--radius-md` | `14px` | Medium cards (requests) |
| `--radius-card` | `16px` | Main cards |
| `--radius-pill` | `999px` | Pills, status badges |

### Spacing

| Token | Value (regular) | Compact | Comfy |
|---|---|---|---|
| `--row-h` | 40 | 34 | 44 |
| `--card-pad` | 24 | 16 | 28 |
| `--gap` | 16 | 12 | 22 |
| `--gap-2` | 20 | 16 | 28 |
| `--gap-3` | 32 | 24 | 40 |

The Tweaks `density` radio cycles between these three.

### Shadows

- `--shadow-card`: subtle inner highlight `0 1px 0 rgba(255,255,255,0.04) inset` (dark)
- `--shadow-modal`: `0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px var(--border-strong)`
- `--shadow-lift`: `0 4px 12px -4px rgba(0,0,0,0.4)` (hover-lifted blocks)

### Iconography

Custom inline SVG icon set defined in `app.jsx`'s `Icon` component — viewBox 24×24, stroke 1.7,
round caps/joins. Set includes: ops, bookings, payments, customers, teams, players, staff,
league, table, cups, settings, tv, plus, search, bell, arrow_r, chevron_l, chevron_r, refresh,
check, x, copy, alert, info, pound, clock, pitch, whistle, phone, whatsapp, mail, drag.

When implementing in your codebase, swap to your existing icon set if you have one (Lucide,
Phosphor, etc.). The visual weight should be similar — 1.5–1.75px stroke, no filled icons.

---

## State, interactions, and behaviour

### App-level state (in `app.jsx` `<App>`)

```js
const TWEAK_DEFAULTS = {
  dark: true,
  density: 'regular',
  type: 'grotesk',
  accent: '#FFC83A',
  liveMatches: 3,            // for stress-testing 0–6 live cards simultaneously
  stateVariant: 'populated', // populated / empty / loading / error
};
```

Strip the Tweaks panel + `TWEAK_DEFAULTS` + `data-theme/data-density/data-type` attribute writing
for production. Dark mode should be the production default; light mode is currently a
prototype-only toggle.

### Per-screen interactions

| Tab | Primary interactions |
|---|---|
| Operations | Click fixture's Pitch / Ref / ••• → modal pickers. Click Approve on a pending registration → approves. Click Reject → reason modal. Click stat tile → scrolls to relevant section or switches tab (Outstanding → Payments). |
| Bookings | Click empty schedule slot → New booking modal pre-filled. Click block → Booking detail modal. Click Cancel → Cancel booking modal with policy-driven defaults. Click "View N more" on Requests → expands grid. |
| Payments | Click Record payment → modal. Click Add charge → modal. Click Void → confirm modal. Inline edit pay link. |
| Customers | Click card → detail modal. Click Nudge → templated message modal. |
| All | ⌘K → Search palette. Bell → Notifications dropdown (clicks outside to close). |

### Animations

- Modal entrance: 220ms `cubic-bezier(0.2, 0.8, 0.3, 1)` from translateY(12px) + opacity 0
- Card entrance: 240ms `ease` fadeup from translateY(4px) + opacity 0
- Live dot pulse: 1.4s infinite (border-shadow + opacity)
- Clock colon blink: 1s steps(1, end) infinite
- Score change: 360ms `cubic-bezier(0.2, 0.7, 0.3, 1)` countup from translateY(8px)
- Schedule occupancy hover: translateY(-1px) + lift shadow, 100ms
- Stat tile hover: arrow chip slides in from translate(-3px,3px) to translate(0,0), opacity
  0→1, 180ms

---

## Data contract & live data flow

The prototype's `src/data.jsx` is the **shape reference**. Replace it with your actual data
layer. Field names match the original surface brief (kept in the prototype where possible).

### Inbound data — what feeds this dashboard

| From | Stream / event | Updates |
|---|---|---|
| **IoO mobile app** | New booking request | append to `pending_bookings` |
| | Player "in" toggle (confirms or unconfirms attendance) | bump `customer.upcoming[].ins` count and trigger nudge_status recompute |
| | Booker cancels their own booking | move from `occupancy` to `cancellations`, trigger refund decision (server-side) |
| | New team registration | append to `pending_registrations` |
| | App admin/VC change | mutate `customer.app_users` |
| **Ref view** (mobile app for the assigned referee) | Match kickoff | `fixture.status: 'allocated' → 'in_progress'` |
| | Live score update (goals, own-goals) | mutate `fixture.home_score` / `away_score` (drives the animated countup) |
| | Goal event (scorer, minute) | append to a `match_events` stream (not modelled in this prototype — see "Unfinished items") |
| | Card / sub events | same |
| | Half-time, full-time | `fixture.status` updates; FT triggers result→standings recompute |
| **Booker's responses** to outbound nudges | Reply received | append to a `nudge_history` per customer |
| **Operator actions** (this dashboard) | Confirm/decline a booking, assign pitch/ref, void a charge, record a payment, cancel a booking | optimistic local update → server confirms → reconciliation |
| **System** | Open incident raised by any subsystem | append to `open_incidents` |

### Outbound data — what this dashboard sources for downstream surfaces

| To | Stream / event | Source field |
|---|---|---|
| **Display screen** (`display.ioo.fc/<display_token>`) | Live fixtures + scores + tonight queue | `fixtures.tonight` + `fixtures.upcoming` |
| | Standings | `standings` |
| | Top scorers | derived from `match_events` (not yet modelled) |
| | Custom message / panels order | `display_config` |
| | PIN gate (4–8 digit) | `display_config.pin_set` |
| **HQ dashboard** | Venue-level aggregates: bookings volume, revenue, pitch utilisation, cancellation rate, customer growth/dormancy | aggregate of `charges` + `cancellations` + `customers.nudge_status` |
| **Reporting** | Full historical export (CSV) | `cancellations` already structured for this (see Export CSV button); add charges + bookings export |

### Suggested wiring approach

Per the brief, the design components are pure presentational and take props. The implementer
should:

1. Pick a state library appropriate to the codebase — **TanStack Query + a websocket subscription
   layer** is a sensible default. Zustand or Redux Toolkit Query both work. The choice is yours.
2. Define topics that match the inbound streams above (e.g. `venue.<id>.fixtures.tonight`,
   `venue.<id>.bookings.pending`, etc.) and a server-pushed event protocol.
3. Map each event to a slice of state, then derive the props that each component already
   expects.
4. Optimistic updates for operator actions; reconcile on server ack.
5. Reconnect logic + a global "stale" banner if the live connection drops > N seconds — the
   topbar's bell badge would be a sensible place to surface that.

---

## Component prop contracts

Each major component currently reads from a top-level `state` prop (from `<App>`). The exact
shapes are visible in `src/data.jsx`. The intended production contract is that each component
takes only what it needs — refactor to fine-grained props during the port.

Key components and their data dependencies (refer to `src/data.jsx` for exact shapes):

| Component | File | Reads |
|---|---|---|
| `FixtureCard` | components.jsx | `fx` (Fixture), `currentMinute` (number), `onPitch`/`onRef`/`onStatus` (callbacks) |
| `Operations` | operations.jsx | `state.fixtures.{tonight,this_week,recent,upcoming}`, `state.pending_registrations`, `state.open_incidents`, `liveCount` |
| `Bookings` | bookings.jsx | `state.venue.bookings_enabled`, `state.occupancy`, `state.pending_bookings`, `window.DATA_cancellations` |
| `CancelBookingModal` | bookings.jsx | a `booking` object + `scope: 'one' \| 'series'`; reads `window.DATA_venue.cancellation_policy` |
| `Payments` | directories.jsx | `state.payments_summary`, `state.charges`, `state.venue.payment_link` |
| `Customers` | customers.jsx | `state.customers` (array of Customer with `app_users`, `upcoming`, `recent`) |
| `StandingsTable` | league_table_cups.jsx | `state.standings`, `state.competitions` |
| `Cups` | league_table_cups.jsx | `state.cup_groups`, `state.cup_bracket`, `state.competitions` |
| `SearchPalette` | topbar_overlays.jsx | full `state` (builds an index from everything) |
| `NotificationsPanel` | topbar_overlays.jsx | full `state` (builds notifications from incidents, fixtures, registrations, bookings, cancellations, customers) |

### Known coupling to clean up

Some components currently access globals directly:

- `window.DATA_teams[teamId]` — team lookups in fixture cards, cancel rows, etc. Convert to a
  `teamsById` prop or context.
- `window.DATA_pitches`, `window.DATA_refs` — sidebar lists and pitch/ref pickers. Same fix.
- `window.DATA_cancellations` — used by `Bookings`, `SearchPalette`, `NotificationsPanel`.
- `window.Icon` — proxied through `const Icon = (p) => React.createElement(window.Icon, p)` in
  most files because each `<script type="text/babel">` is its own scope. With proper imports
  this collapses to a single `import { Icon } from './app'`.

These all work in the prototype because the CDN-Babel setup shares globals. With Vite/ESM
imports it becomes a normal `import` per file.

---

## Things that are placeholder / unfinished

Flagged for the implementer to know what is and isn't real:

1. **Search palette** — works against the in-memory index. With a real backend, wire to a search
   endpoint (or build an in-memory index from current state if dataset is small).
2. **Notifications panel** — "seen" state persists to `localStorage` under
   `iotools:notifs-seen`. Move to user-scoped storage server-side eventually.
3. **Export CSV** button on Cancellations — placeholder.
4. **Refund/charge wiring into Payments tab** — when a cancellation runs through
   `CancelBookingModal`, the refund/charge isn't currently posted into the charges table.
   Should be: a Full refund creates a `refunded`-status row; a 50% credit leaves the charge at
   half-paid + a credit memo; No refund leaves the charge untouched.
5. **Match events stream** (goals, cards, subs) — not modelled in this prototype. Needed for
   Display surface's goals ticker and Top scorers panel.
6. **Mobile Operations layout** — desktop works at all widths but a true one-handed pitchside
   redesign of Operations is a known gap. The brief calls this out as a hard requirement.
7. **Speaker / sound alerts** for critical incidents — not designed.
8. **Tweaks panel** — prototype-only. Strip from production.
9. **`prototype_v1_editorial_reference.html`** — rejected direction, keep for reference only.

---

## Recommended porting steps

1. Spin up a Vite + React app. Plain CSS (no Tailwind / no component library) per the brief.
2. Copy `src/styles2.css` → `src/styles.css`. Strip the `[data-theme="light"]` block if light
   mode isn't part of v1, or keep both and gate via a theme provider.
3. Convert each `.jsx` file to ES module syntax — replace `Object.assign(window, { ... })` at
   the bottom with `export { ... }`, replace the `const Icon = (p) => window.Icon ? ...` proxies
   with `import { Icon } from './Icon'`.
4. Extract the inline `Icon` SVG registry from `app.jsx` into its own `Icon.jsx`.
5. Drop the Babel CDN + `<script type="text/babel">` tags in the entry HTML. Replace with a
   single Vite-built bundle.
6. Replace `src/data.jsx` with your data layer (API client + state store). Match field names
   from the data fixtures so component props remain unchanged.
7. Wire the inbound streams per the **Data contract & live data flow** section above.
8. Implement the mobile Operations layout (out of scope for this bundle but called out in the
   brief).
9. Implement the missing items from "Things that are placeholder / unfinished" as they're
   reached.

---

## Files in this bundle

```
prototype.html
prototype_v1_editorial_reference.html
tweaks-panel.jsx
src/app.jsx
src/bookings.jsx
src/components.jsx
src/customers.jsx
src/data.jsx
src/directories.jsx
src/league_table_cups.jsx
src/modals_misc.jsx
src/operations.jsx
src/styles.v1.css
src/styles2.css
src/topbar_overlays.jsx
screenshots/
  01-operations.png
  02-bookings.png
  03-payments.png
  04-customers.png
  05-teams.png
  06-players.png
  07-staff.png
  08-leagues.png
  09-table.png
  10-cups.png
  11-light-mode.png
```

Screenshots were captured at a narrower viewport (~920px wide) so the stat-tile labels and some
table columns truncate. The intended layouts assume desktop ≥1280px. Open `prototype.html`
directly for the live, full-width experience.

Open `prototype.html` directly in a browser to view the design. The Tweaks panel (bottom-right
toggle) lets you switch theme/density/type and stress-test live-match count and state variant.
