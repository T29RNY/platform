# WATCH_DESIGN_HANDOFF.md — In or Out watchOS Ref App

> Returned by Claude Design against `WATCH_DESIGN_BRIEF.md`. Consumed by Claude Code in Phase 0
> (component kit) and Phase 2+ (live screens). All tokens mapped from
> `apps/inorout/src/theme/tokens.css` — source var names cited inline. Resolver-driven screens
> (Home, N-games chooser) designed against the LOCKED `get_my_next_assignment` shape (mig 369):
> `{ ok, game_count, next:<game|null>, games:[<game>...] }`,
> `game = { context, role, ref_token, game_id, kickoff_at, status, is_in_progress, venue_name,
> home_team, away_team, squad_name }`.

Design language in one line: **broadcast-dark, condensed-numeral, one-glance**. The wrist is a
referee's instrument panel — clock and score are always the loudest thing on screen; everything
else is a quiet tappable affordance with a 44pt+ target. No gradients-for-decoration, no fitness-app
rings as hero, no playful motion. Confidence through restraint.

---

## 0. CONTENTS

1. Tokens block (hex / type ramp / spacing / radii — mapped from tokens.css + Bebas substitute)
2. Screen-by-screen mockups (14-item inventory + always-on dimmed variants)
3. Per-component SwiftUI specs (with stubs)
4. Interaction map (Crown / Double Tap / haptics / transitions / sync states)
5. Complication + Smart Stack widget
6. App icon set + complication assets
7. Live Activity + Dynamic Island
8. Accessibility notes

---

## 1. TOKENS BLOCK

### 1.1 Colour — mapped 1:1 from `tokens.css`

| Watch role | Hex | tokens.css source var | Notes |
|---|---|---|---|
| Canvas / OLED base | `#0A0A08` | `--bg` | True near-black — free OLED battery + max contrast. Use as the Always-On base too. |
| Surface 1 (cards) | `#141412` | `--s1` | Player rows, docks. |
| Surface 2 (raised) | `#1C1C19` | `--s2` | Modals, sub-picker sheet. |
| Surface 3 (pressed) | `#222220` | `--s3` | Button pressed state. |
| Hairline border | `rgba(255,255,255,0.10)` | `--border-subtle` | 0.5pt strokes only. |
| Text primary | `#F2F0EA` | `--t1` | Clock, score, names. |
| Text secondary | `#D0CCC2` | `--t2` | Captions, venue, metadata. |
| Brand IN / positive / GOAL | `#3DDC6A` | `--green` | "IN" lockup, goal flash, synced dot, kickoff CTA. |
| Brand OUT / red card | `#FF4040` | `--red` | "OUT" lockup, red card, destructive. |
| Yellow card / caution | `#FFB020` | `--amber` | Yellow card, "half-time approaching", offline warning. |
| Gold / accent / decider | `#E8A020` | `--gold` | Knockout decider, FT-confirm primary, complication tint. |
| Sin-bin / period accent | `#B060F0` | `--purple` | Sin-bin countdown, ET/PEN period chips. |
| Draw / level | `#14B8A6` | `--draw` | Level-score indicator in decider. |
| Team A (FIXED) | `#60A0FF` | (hard literal — brand rule) | Never tokenised; allowed hardcode. |
| Team B (FIXED) | `#FF6060` | (hard literal — brand rule) | Never tokenised; allowed hardcode. |
| Max-contrast label | `#000` / `#fff` | `--black` / `--white` | Text on gold/green/coloured fills. |

Tint pairs (`--green2/greenb`, `--red2/redb`, `--amber2/amberb`, `--purple2/purpleb`, `--gold2/goldb`)
map to SwiftUI as `color.opacity(0.13)` fill + `color.opacity(0.35)` stroke — used for chip and
pressed-state backgrounds so the watch carries no new hardcoded hex.

> **Note on Team A/B vs card colours:** Team A `#60A0FF` (blue) and Team B `#FF6060` (red-pink) sit
> close to the amber/red card palette. NEVER signal a card by team-tinting a row. Cards are always a
> discrete glyph + label (§8 colour-blind rules). Team colour is used ONLY as a 3pt leading spine on
> player rows and the score-half background tint.

### 1.2 Type ramp

`tokens.css` ships `--font-display: 'Bebas Neue'` and `--font-body: 'DM Sans'`. Neither is a system
watch face, and **Bebas Neue is NOT viable on watchOS at glance sizes** — its tight tracking and thin
strokes smear at small point sizes and in the Always-On dimmed/low-update state, and bundling a
custom font costs binary size + a `Font.custom` everywhere.

**Substitute decision (load-bearing):**
- **Numerals & big headline (clock, score, countdown, decider digits)** → **SF Compressed / Rounded,
  `.bold`, monospaced digits.** Use `Font.system(size:weight:design:)` with
  `.monospacedDigit()`. This is the closest *legible* analogue to Bebas's condensed broadcast energy,
  it's a system font (free, accessible, Dynamic-Type-aware), and `monospacedDigit` stops the clock
  from "jittering" as digits change each second.
  - Concretely: `Font.system(size: 34, weight: .bold, design: .rounded).monospacedDigit()` for the
    clock; widen with `.fontWidth(.compressed)` (watchOS 10+) to recover the Bebas condensed feel.
- **Body / labels / names** → **SF Pro Text** (`Font.system(... design: .default)`) — maps to
  `--font-body`'s "DM Sans / -apple-system" intent. System default = Dynamic Type for free.

| Ramp token | Use | Spec |
|---|---|---|
| `clockXL` | Live clock | `.system(size: 34, weight: .bold, design: .rounded).width(.compressed).monospacedDigit()` |
| `scoreXL` | Score digits | `.system(size: 40, weight: .heavy, design: .rounded).monospacedDigit()` |
| `countdownL` | "in 2h 14m" | `.system(size: 30, weight: .bold, design: .rounded).monospacedDigit()` |
| `titleM` | Screen titles, team names | `.system(size: 17, weight: .semibold)` |
| `bodyM` | Player names, settings rows | `.system(size: 15, weight: .regular)` |
| `captionS` | Venue, kickoff, metadata | `.system(size: 12, weight: .regular)` → `--t2` |
| `chipS` | Period chip, badges | `.system(size: 13, weight: .bold).width(.compressed)` |
| `microXS` | Sync state, controller badge | `.system(size: 10, weight: .semibold)` |

All sizes scale with Dynamic Type via `.dynamicTypeSize(...)` (§8); the values above are the default
(`.large`) anchor.

### 1.3 Spacing scale (4pt base — watch-tightened)

| Token | pt | Use |
|---|---|---|
| `space1` | 2 | Icon-to-label gap inside a chip |
| `space2` | 4 | Tight intra-component |
| `space3` | 8 | Default element gap, row inner padding |
| `space4` | 12 | Card padding, section gap |
| `space5` | 16 | Screen horizontal margin (45mm); maps to `--r` rhythm |
| `space6` | 24 | Major vertical break between header and list |

Screen edge insets: **10pt (41mm) / 12pt (45mm) / 14pt (49mm)** — scale with `WKInterfaceDevice`
screen bounds; never less than 8pt so content clears the bezel curve.

### 1.4 Corner radii — mapped from `tokens.css`

| Watch token | pt | tokens.css source | Use |
|---|---|---|---|
| `rCard` | 16 | `--r` (16px) | Cards, modals, score header |
| `rSmall` | 10 | `--rs` (10px) | Player rows, chips |
| `rButton` | 12 | `--r-button` (12px) | Action buttons |
| `rPill` | 20 / `.capsule` | `--r-pill` (20px) | Period chip, countdown pill, sync pill |

On watchOS use **continuous** corners: `.clipShape(RoundedRectangle(cornerRadius: rCard, style: .continuous))`
to match the iOS app's soft-square feel.

---

## 2. SCREEN-BY-SCREEN MOCKUPS

Wireframes are drawn at ~**45mm** proportion (≈198×242pt usable). Notes call out **41mm** (tighter,
single-column, hide secondary captions) and **49mm** (more vertical air, captions always shown).
`[AO]` = Always-On dimmed variant follows.

Legend: `█` filled brand element · `▓` surface card · `·` hairline · `◉` synced · `◐` pending · `⊘` offline

---

### SCREEN 1 — SIGN-IN (3 states)

**1a. Handoff from phone (primary path)**
```
┌──────────────────────┐
│  IN·OR·OUT           │  ← lockup: IN green, OR t2, OUT red
│                      │
│      📲  ⌚           │  symbol: iphone.gen3 → applewatch
│                      │
│  Signing you in      │  titleM
│  from your iPhone…   │  captionS t2
│                      │
│   ◌  (progress)      │  ProgressView, gold tint
│                      │
│  Use a code instead  │  ← text button, t2 underline → 1b
└──────────────────────┘
```
WatchConnectivity handoff auto-runs on launch. If it stalls >6s, surface the "Use a code instead"
escape (never hang — guardrail #8).

**1b. Email code entry**
```
┌──────────────────────┐
│  ‹ Back              │
│  Enter your code     │ titleM
│  Sent to a…@mail.com │ captionS t2
│                      │
│   ┌──┬──┬──┬──┬──┬──┐│
│   │2 │4 │8 │_ │_ │_ ││  ← 6-cell OTP, mono, active cell green underline
│   └──┴──┴──┴──┴──┴──┘│
│                      │
│   Resend code (28s)  │ captionS, disabled→countdown
└──────────────────────┘
```
Tap field → system numeric keyboard / Scribble / dictation. Full 6 digits → auto-submit. (Carry the
OTP-length-cap lesson: cell count == 6 exactly, no silent truncation.)

**1c. Sign in with Apple (Apple-review requirement + bonus)**
```
┌──────────────────────┐
│  IN·OR·OUT           │
│                      │
│  Welcome             │ titleM
│  Sign in to ref      │ captionS t2
│                      │
│  ┌──────────────────┐│
│  │  Sign in with    ││  ← SignInWithAppleButton, .black style,
│  │   Apple        ││     rButton, full-width, 50pt tall
│  └──────────────────┘│
│  Use email code      │ → 1b
└──────────────────────┘
```
No Always-On variant for sign-in screens (not a live screen).

---

### SCREEN 2 — HOME / "YOUR NEXT GAME"  *(resolver: `game_count == 1`, render `next`)*

Driven by `get_my_next_assignment`. When `game_count == 1`, render `next` directly.
`context == 'casual'` → show `squad_name` + Team A/Team B; `context == 'league'` → `home_team` v `away_team`.

**2a. League next game**
```
┌──────────────────────┐
│  NEXT GAME      ◉    │ microXS caption + sync dot top-right
│                      │
│   in 2h 14m          │ countdownL, gold  (from kickoff_at)
│  ·················   │
│  Finbar's FC         │ titleM, leading spine #60A0FF-ish? NO →
│      v               │   league uses --t1 names, no team tint
│  Rovers AFC          │ titleM
│                      │
│  📍 Hackney Marshes  │ captionS t2 (venue_name)
│  🕐 19:30 · Referee  │ captionS t2 (role)
│  ┌──────────────────┐│
│  │      OPEN  ▸     ││ █ green fill, black label, 50pt, rButton
│  └──────────────────┘│
└──────────────────────┘
```

**2b. Casual next game** (`context == 'casual'`)
```
┌──────────────────────┐
│  NEXT GAME      ◉    │
│   LIVE NOW           │ ← if is_in_progress: red dot + "LIVE NOW", no countdown
│                      │
│  Tuesday Squad       │ titleM (squad_name)
│  ┌────────┐┌────────┐│
│  │ TEAM A ││ TEAM B ││ chipS — A bg #60A0FF@.13 / B bg #FF6060@.13
│  └────────┘└────────┘│
│  📍 Goals Vauxhall   │
│  🕐 In progress · Ref│
│  ┌──────────────────┐│
│  │    RESUME  ▸    ││ █ amber fill (in-progress) else green
│  └──────────────────┘│
└──────────────────────┘
```
Empty state (`game_count == 0`, `next == null`): centred `whistle` glyph (Phosphor-thin asset) + "No
games assigned" titleM + "You'll see your next game here" captionS. Smart Stack still installs.

**41mm:** drop the venue/time captions to a single line "19:30 · Hackney"; **49mm:** add a thin
divider + "Tap teams for squads" hint.

**`[AO]` Home dimmed:** countdown + team line only, `--t2` luminance, OPEN button rendered as a thin
gold outline (not filled — Always-On must not push bright fills). Sync dot hidden.

---

### SCREEN 3 — PRE-MATCH
```
┌──────────────────────┐
│ ‹ Finbar's v Rovers  │ titleM truncate
│  ▓ TEAM SHEETS    ⌄ ▓│ surface card, tap → squad list (Crown scroll)
│   Finbar's (11)      │ bodyM, #60A0FF spine
│   Rovers (11)        │ bodyM, #FF6060 spine
│  ·················   │
│  ⓘ Health tracking   │ captionS amber
│  starts when you tap │
│  Start Match here    │
│  ┌──────────────────┐│
│  │  START MATCH ▸  ││ █ green, 54pt (the gate), heart.fill lead glyph
│  └──────────────────┘│
└──────────────────────┘
```
The health note is amber + non-dismissable text directly above the gate (decision: health only when
started from watch). Double Tap confirms START MATCH. No Always-On (pre-live; screen sleeps to face).

---

### SCREEN 4 — LIVE MATCH  *(the core screen)*

```
┌──────────────────────┐
│ 1H    ◉   ⌚CTRL     │ period chip(L) · sync(C-R) · clock-controller badge
│ ┌──────────────────┐ │
│ │  45:12       2-1 │ │ clockXL t1 (left) · scoreXL (right)
│ │  ███       A   B │ │ score halves tinted #60A0FF@.13 / #FF6060@.13
│ └──────────────────┘ │  ← SCORE HEADER (sticky, survives Always-On)
│ ▓ #7 J. Carter   ⚽ │ player row, A spine, tap-target 44pt
│ ▓ #9 M. Reece    🟨 │ player row
│ ▓ #4 T. Osei        │
│  … Crown-scroll …   │
│ ┌────┬────┬────┬───┐ │  ACTION DOCK (fixed bottom, 5 primary)
│ │⚽  │🟨  │🔁  │ ⋯ │ │  goal · card · sub · more(sin-bin/note/own-goal/red)
│ └────┴────┴────┴───┘ │
└──────────────────────┘
```
- **Action model:** tap a **player row** to select scorer/carded player, then tap an action; OR tap
  action first → sub-picker / player-picker modal. **Long-press ⚽ = own-goal.** `⋯` (more) opens a
  grid: own-goal / red / sin-bin / note / added-time.
- **Clock controller badge** `⌚CTRL`: shown only when >1 recorder detected on the `ref_token` channel.
  microXS, purple outline pill. Means "this watch holds the clock" — assistant should not also drive
  it. When another recorder holds it, badge reads `WEB CTRL` greyed.
- **30s undo:** after any event a thin bar slides up from the dock: `Goal · #7 Carter  ↶ Undo 28s`
  (amber progress hairline draining).

**`[AO] Live dimmed`** (mandatory, battery-throttled — update ≤1/min, no per-second tick):
```
┌──────────────────────┐
│ 1H              45’  │ period + clock to the MINUTE only (no seconds)
│                      │
│      2  –  1         │ scoreXL, --t2 luminance, A/B tint at .35 sat
│      A     B         │
│                      │
│ (rows + dock hidden) │ ← interaction disabled; tap-to-wake → full
└──────────────────────┘
```
Always-On keeps clock+score legible (brief requirement) at reduced luminance; seconds drop to avoid a
1s redraw. Tap or wrist-raise restores the full Live screen instantly.

---

### SCREEN 5 — SUB PICKER MODAL (sheet over Live)
```
┌──────────────────────┐
│  SUBSTITUTION    ✕  │ titleM · dismiss
│  Finbar's            │ captionS #60A0FF
│  OFF                 │
│  ▓ #9 M. Reece    ● │ selected = green check
│  ON                  │
│  ▓ #14 K. Banjo     │
│  ▓ #16 D. Ellis     │  Crown-scroll bench
│  ┌──────────────────┐│
│  │   CONFIRM SUB   ││ █ green, disabled until both chosen
│  └──────────────────┘│
└──────────────────────┘
```
`.sheet` presentation, `--s2` bg, `rCard`. Double Tap = CONFIRM SUB once both selected.

---

### SCREEN 6 — PERIOD CONTROLS DOCK
```
┌──────────────────────┐
│  PERIOD              │ titleM
│  Current: 1H         │ captionS t2
│  ┌─────┐┌─────┐      │
│  │ HT  ││ 2H  │      │ tiles, 44pt, rButton, amber=HT
│  └─────┘└─────┘      │
│  ┌─────┐┌─────┐      │
│  │ ET  ││ PEN │      │ purple accent (extra periods)
│  └─────┘└─────┘      │
│  ┌──────────────────┐│
│  │   FULL TIME     ││ █ gold, leads to FT-confirm (Screen 7)
│  └──────────────────┘│
└──────────────────────┘
```
Reached via `⋯` or swipe from Live. Selecting HT fires the "half-time approaching" haptic pre-emptively
when clock nears period end (see §4). Each tile maps to `ref_set_period`.

---

### SCREEN 7 — FULL-TIME CONFIRM
```
┌──────────────────────┐
│  ⚠ FULL TIME?       │ titleM gold
│  Finbar's 2 – 1 Rov  │ scoreXL-ish, mono
│                      │
│  This ends the match │ captionS t2
│  and your health     │
│  tracking.           │
│  ┌──────────────────┐│
│  │  CONFIRM FT  ▸  ││ █ gold, black label, 54pt
│  └──────────────────┘│
│  Cancel              │ t2 text button
└──────────────────────┘
```
Two-step (deliberate friction — FT ends the workout). Double Tap confirms. Triggers full-time haptic.
If score is level and context allows knockout → routes to Screen 8 instead of ending.

---

### SCREEN 8 — KNOCKOUT DECIDER (AET steppers + shootout)
```
┌──────────────────────┐
│  DECIDER             │ titleM gold
│  AET 2 – 2           │ captionS t2
│  PENALTIES           │ chipS purple
│   A          B       │
│  ┌───┐      ┌───┐    │
│  │ 4 │      │ 3 │    │ scoreXL, Crown-adjustable steppers
│  └───┘      └───┘    │ #60A0FF / #FF6060 tint
│   ✓✓✓✓○    ✓✓✓✗○    │ shootout dots: ✓ scored ✗ missed ○ pending
│  ┌────┐┌────┐        │
│  │ A− ││ A+ │ …      │ explicit ± if Crown not used (44pt)
│  └────┘└────┘        │
│  ┌──────────────────┐│
│  │  WINNER: TEAM A ││ █ green, → ref_record_knockout_decider
│  └──────────────────┘│
└──────────────────────┘
```
**Digital Crown** focuses a stepper (tap to select A or B side; Crown rotates the value, haptic detent
per increment). Shootout dot row is the colour-blind-safe glyph layer over the numeric score.
`[AO]` dimmed: AET line + current pen score `4–3`, dimmed, no steppers.

---

### SCREEN 9 — POST-MATCH SUMMARY
```
┌──────────────────────┐
│  FULL TIME      ◉   │
│  Finbar's 2 – 1 Rov  │ scoreXL
│  ·················   │
│  ⚽ Carter 23'       │ bodyM, A spine
│  ⚽ Reece 51'        │
│  ⚽ Idris 67' (Rov)  │ B spine
│  🟨 Osei 40'         │
│  🔁 Reece→Banjo 70'  │
│  ┌──────────────────┐│
│  │  Health summary ▸││ → Screen 10 (refs only)
│  └──────────────────┘│
│  Done                │ → Home
└──────────────────────┘
```
Crown-scroll event list. No Always-On (post-live).

---

### SCREEN 10 — HEALTH SUMMARY (refs only) + LIVE HR ELEMENT

**10a. Post-match health summary**
```
┌──────────────────────┐
│  YOUR MATCH          │ titleM
│  ❤️ 142 avg · 176 max│ bodyM, red heart glyph
│  🔥 612 kcal         │ bodyM amber
│  📏 8.4 km           │ bodyM
│  ⏱ 94 min           │ bodyM
│  ·················   │
│  HR ZONES            │ chipS (watchOS 27 only)
│  Z5 ▓▓░░░░  8m       │ stacked bars, zone-coloured
│  Z4 ▓▓▓▓░░ 22m       │  Z5 red→Z1 teal, never colour-only:
│  Z3 ▓▓▓▓▓░ 38m       │  label + duration always present
│  Z2 ▓▓░░░░ 18m       │
│  Z1 ▓░░░░░  8m       │
└──────────────────────┘
```
On watchOS 26 (no zones): hide the HR ZONES block, keep avg/max (graceful fallback per plan).

**10b. Live HR-zone element** (sits in Live screen header, refs only, opt-in glance):
```
 ❤︎ 168  ┃ Z4 ┃   ← compact: heart + bpm + current zone chip (zone-coloured
                     ring, but chip carries "Z4" text so it's not colour-only)
```
Rendered as a small trailing capsule in the Live score header OR a dedicated Crown-page swipe-left from
Live. Updates on zone-change events (throttled in Always-On). Heart glyph pulses subtly on beat in full
brightness only.

---

### SCREEN 11 — SETTINGS
```
┌──────────────────────┐
│  SETTINGS            │ titleM
│  ▓ Account           │ row → email + provider
│    a…@mail.com       │ captionS t2
│  ▓ Health tracking ⓘ │ row → explainer sheet
│  ▓ Haptics      On ◉ │ toggle
│  ·················   │
│  ▓ Sign out      ↩  │ red label row
│  IN·OR·OUT  v1.0     │ microXS t2, brand lockup footer
└──────────────────────┘
```
Health-tracking row opens an explainer: *"When you start a match from your watch, In or Out records an
Outdoor Football workout (heart rate, energy, distance) for that game only. Stored as a summary, never
the raw stream. Delete anytime from your account."* (UK-GDPR framing, guardrail #6.)

---

### SCREEN 12 — COMPLICATION + SMART STACK  *(see §5 for full spec)*
### SCREEN 13 — APP ICON  *(see §6)*
### SCREEN 14 — LIVE ACTIVITY + DYNAMIC ISLAND  *(see §7)*

---

## 3. PER-COMPONENT SWIFTUI SPECS

All tap targets ≥ **44pt** (Apple HIG watch minimum). Buttons use `.buttonStyle(.plain)` + custom
fills so brand colour is exact. SF Symbol named first; Phosphor-thin asset fallback named where the SF
glyph is off-brand.

| Component | Symbol / asset | Size | States | Tap pt |
|---|---|---|---|---|
| **Score header** | — | clockXL/scoreXL | live / paused (clock amber) / FT (gold) / AO-dimmed | full width, non-tap (sticky) |
| **Period chip** | `1H/2H/HT/ET/PEN/FT` text | chipS, rPill | 1H,2H = t1; HT = amber; ET,PEN = purple; FT = gold | 44×28 |
| **Player row** | leading 3pt team spine | bodyM | default / selected(green ring) / has-card(glyph) / subbed-off(strikethrough t2) | full width × 44 |
| **Goal button** | `soccerball` | 24pt glyph | tap=goal · long-press=own-goal · disabled until player picked | 56×52 |
| **Own-goal** | `soccerball` + `arrow.uturn.backward` | 22pt | in ⋯ grid | 52×52 |
| **Yellow card** | `rectangle.portrait.fill` amber | 22pt | first / second-yellow(→auto red prompt) | 52×52 |
| **Red card** | `rectangle.portrait.fill` red | 22pt | in ⋯ grid | 52×52 |
| **Sub button** | `arrow.left.arrow.right` | 22pt | opens sub-picker | 56×52 |
| **Sin-bin** | `timer` / Phosphor `timer-thin` | 22pt | sets countdown; row shows live `2:00→0:00` purple | 52×52 |
| **Note** | `square.and.pencil` | 22pt | opens dictation/scribble note | 52×52 |
| **Added-time** | `plus.circle` | 22pt | Crown stepper 0–9 min | 52×52 |
| **Sub-picker modal** | — | sheet | off-selected / on-selected / confirm-enabled | rows 44 |
| **Period dock tile** | text | titleM | idle / current(filled tint) | 44×44 min |
| **FT-confirm** | `flag.checkered` | 24pt | armed / confirming | 54 tall |
| **Decider stepper** | `chevron.up/down` + Crown | scoreXL | A-focused / B-focused / idle | ± 44×44 |
| **Sync indicator** | `circle.fill`/`arrow.triangle.2.circlepath`/`wifi.slash` | 10pt | ◉synced green · ◐pending amber spin · ⊘offline red | 24 (status, non-tap) |
| **Clock-controller badge** | `applewatch` / `globe` | microXS pill | this-watch(purple) · web-holds(grey) · solo(hidden) | non-tap |
| **Live HR/zone** | `heart.fill` + zone chip | bodyM | zone Z1–Z5 coloured + labelled · no-data(hidden, wOS26) | 44 (swipe page) |
| **Undo bar** | `arrow.uturn.backward` | bodyM | 30s draining → auto-dismiss | full width × 36 |
| **Brand lockup** | text | titleM | static | non-tap |

### 3.1 SwiftUI stubs (Phase 0 kit)

```swift
// MARK: - Design tokens (mapped from tokens.css)
enum IO {
    // Colour — from tokens.css var names in comments
    static let bg       = Color(hex: 0x0A0A08) // --bg
    static let s1       = Color(hex: 0x141412) // --s1
    static let s2       = Color(hex: 0x1C1C19) // --s2
    static let s3       = Color(hex: 0x222220) // --s3
    static let t1       = Color(hex: 0xF2F0EA) // --t1
    static let t2       = Color(hex: 0xD0CCC2) // --t2
    static let green    = Color(hex: 0x3DDC6A) // --green   IN / goal / synced
    static let red      = Color(hex: 0xFF4040) // --red     OUT / red card
    static let amber    = Color(hex: 0xFFB020) // --amber   yellow / warn
    static let gold     = Color(hex: 0xE8A020) // --gold    decider / FT
    static let purple   = Color(hex: 0xB060F0) // --purple  sin-bin / ET-PEN
    static let draw     = Color(hex: 0x14B8A6) // --draw    level
    static let teamA    = Color(hex: 0x60A0FF) // FIXED brand literal
    static let teamB    = Color(hex: 0xFF6060) // FIXED brand literal
    static let hairline = Color.white.opacity(0.10) // --border-subtle

    // Radii — from tokens.css
    static let rCard: CGFloat = 16   // --r
    static let rSmall: CGFloat = 10  // --rs
    static let rButton: CGFloat = 12 // --r-button
    static let rPill: CGFloat = 20   // --r-pill

    // Type ramp (Bebas → SF Compressed/Rounded substitute)
    static let clockXL  = Font.system(size: 34, weight: .bold,  design: .rounded).monospacedDigit()
    static let scoreXL  = Font.system(size: 40, weight: .heavy, design: .rounded).monospacedDigit()
    static let titleM   = Font.system(size: 17, weight: .semibold)
    static let bodyM    = Font.system(size: 15, weight: .regular)
    static let captionS = Font.system(size: 12, weight: .regular)
    static let chipS    = Font.system(size: 13, weight: .bold)
    static let microXS  = Font.system(size: 10, weight: .semibold)
}

// MARK: - Brand lockup
struct BrandLockup: View {
    var body: some View {
        (Text("IN").foregroundStyle(IO.green)
         + Text("·OR·").foregroundStyle(IO.t2)
         + Text("OUT").foregroundStyle(IO.red))
        .font(IO.titleM.width(.compressed))
        .accessibilityLabel("In or Out")
    }
}

// MARK: - Score header (sticky, Always-On aware)
struct ScoreHeader: View {
    let clock: String          // "45:12" full, "45’" in AO
    let scoreA: Int, scoreB: Int
    let isAlwaysOn: Bool
    var body: some View {
        HStack {
            Text(clock)
                .font(IO.clockXL)
                .foregroundStyle(isAlwaysOn ? IO.t2 : IO.t1)
            Spacer()
            HStack(spacing: 6) {
                Text("\(scoreA)").foregroundStyle(IO.t1)
                Text("–").foregroundStyle(IO.t2)
                Text("\(scoreB)").foregroundStyle(IO.t1)
            }
            .font(IO.scoreXL)
        }
        .padding(IO.space4)
        .background(
            LinearGradient(colors: [IO.teamA.opacity(0.13), IO.teamB.opacity(0.13)],
                           startPoint: .leading, endPoint: .trailing),
            in: RoundedRectangle(cornerRadius: IO.rCard, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(clock). Score \(scoreA) to \(scoreB)")
    }
}

// MARK: - Period chip
struct PeriodChip: View {
    let period: Period
    var tint: Color {
        switch period { case .ht: return IO.amber
        case .et, .pen: return IO.purple
        case .ft: return IO.gold
        default: return IO.t1 }
    }
    var body: some View {
        Text(period.label).font(IO.chipS.width(.compressed))
            .padding(.horizontal, 8).padding(.vertical, 4)
            .foregroundStyle(tint)
            .overlay(Capsule().stroke(tint.opacity(0.35), lineWidth: 1))
            .accessibilityLabel(period.spokenLabel) // "First half" etc.
    }
}

// MARK: - Action button
struct ActionButton: View {
    let symbol: String; let tint: Color; let action: () -> Void
    var onLongPress: (() -> Void)? = nil
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 22, weight: .medium))
                .frame(width: 52, height: 52)
                .foregroundStyle(tint)
                .background(IO.s1, in: RoundedRectangle(cornerRadius: IO.rButton, style: .continuous))
        }
        .buttonStyle(.plain)
        .frame(minWidth: 56, minHeight: 52) // ≥44pt rule
        .simultaneousGesture(LongPressGesture().onEnded { _ in onLongPress?() })
    }
}

// MARK: - Player row
struct PlayerRow: View {
    let number: Int; let name: String; let team: Team
    let badge: PlayerBadge?  // .goal/.yellow/.red/.subbedOff/.sinBin(secondsLeft)
    var selected = false
    var body: some View {
        HStack(spacing: IO.space3) {
            Rectangle().fill(team == .a ? IO.teamA : IO.teamB).frame(width: 3) // spine
            Text("#\(number)").font(IO.bodyM.monospacedDigit()).foregroundStyle(IO.t2)
            Text(name).font(IO.bodyM).foregroundStyle(IO.t1).lineLimit(1)
            Spacer()
            if let badge { badge.glyph } // glyph + label, never colour-only
        }
        .padding(.horizontal, IO.space3).frame(minHeight: 44)
        .background(IO.s1, in: RoundedRectangle(cornerRadius: IO.rSmall, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: IO.rSmall)
            .stroke(IO.green, lineWidth: selected ? 2 : 0))
        .accessibilityLabel("\(team.spoken) number \(number) \(name)\(badge?.spoken ?? "")")
    }
}

// MARK: - Sync indicator
struct SyncDot: View {
    enum State { case synced, pending, offline }
    let state: State
    var body: some View {
        Group {
            switch state {
            case .synced:  Image(systemName: "circle.fill").foregroundStyle(IO.green)
            case .pending: Image(systemName: "arrow.triangle.2.circlepath")
                               .foregroundStyle(IO.amber).symbolEffect(.rotate)
            case .offline: Image(systemName: "wifi.slash").foregroundStyle(IO.red)
            }
        }
        .font(.system(size: 10, weight: .bold))
        .accessibilityLabel(spoken) // "Synced" / "Pending" / "Offline"
    }
}
```
(`Color(hex:)` extension + `Period`/`Team`/`PlayerBadge` enums ship in the kit.)

---

## 4. INTERACTION MAP

### 4.1 Digital Crown targets
| Surface | Crown action | Detent / haptic |
|---|---|---|
| Live match list | Scroll player rows | standard scroll |
| Added-time stepper (`⋯`) | 0→9 minutes | `.clickHaptic` per minute |
| Knockout decider | Adjust focused side's score (tap A/B to focus) | detent per increment |
| Health zones list | Scroll Z5→Z1 | standard scroll |
Crown is the ONLY numeric input for steppers (brief mandate); ± buttons exist as the non-Crown fallback.

### 4.2 Double Tap = confirm current primary action (Series 9+/Ultra 2)
Double Tap always fires the **screen's single primary CTA**, hands-free (whistle in the other hand):
| Screen | Double Tap fires |
|---|---|
| Pre-match | START MATCH |
| Live (no modal) | record GOAL for the selected player (if one selected) |
| Sub picker | CONFIRM SUB (when both chosen) |
| FT confirm | CONFIRM FT |
| Decider | WINNER (when a side leads) |
| Undo bar visible | UNDO (Double Tap re-targets to undo while the 30s bar is up) |
Primary CTA is always visually singular (one filled button) so Double Tap is unambiguous.

### 4.3 Haptic patterns (`WKHapticType` + custom)
| Event | Haptic | Rationale |
|---|---|---|
| Goal recorded | `.success` | crisp positive confirm |
| Card recorded | `.notification` | distinct, neutral |
| Half-time **approaching** (clock hits period_length − 1min) | `.directionUp` ×2, 0.4s apart | pre-warning, felt not seen |
| Full-time reached / confirmed | `.success` then `.stop` | finality |
| Sin-bin **expiry** (countdown hits 0) | `.notification` ×3 escalating | player may return — must be felt mid-match |
| Undo window expiring (last 5s) | `.click` once at 5s | last chance |
| Crown stepper increment | `.click` | tactile counting |
| Offline → reconnected (queue drained) | `.success` (soft) | reassurance |
Haptics respect the Settings toggle (Screen 11) except FT and sin-bin-expiry (safety-critical, always on).

### 4.4 Screen transitions
- Home → Pre-match: push (slide-in), back-swipe returns.
- Pre-match → Live: **cross-fade + score header scales up** (match goes live — momentous).
- Live → Sub/Period/FT: `.sheet` slide-up over dimmed Live.
- Live ⟷ Live HR page: horizontal Crown/swipe paging (`.tabViewStyle(.verticalPage)` siblings).
- FT confirm → Post-match: cross-fade; → Decider: push when level.
- Always-On dim: system-driven; the live view branches on `isLuminanceReduced` (Environment) — no
  custom transition, just the dimmed layout swap.

### 4.5 Sync states (synced / pending / offline + 30s undo)
- **Optimistic write**: event lands in UI instantly (`◐ pending` dot), enqueued with `client_event_id`.
- **Synced**: RPC ack → `◉ green`, brief.
- **Offline**: `⊘` red pill + "Offline — saved on this watch" toast; queue drains + replays
  idempotently on reconnect (port of `offlineQueue.js`), then soft success haptic.
- **30s undo**: every event shows the draining undo bar; `ref_undo_event` if tapped; server is source
  of truth on relaunch (events re-derive state — guardrail #8).

---

## 5. COMPLICATION + SMART STACK WIDGET

### 5.1 Watch face complications (WidgetKit / ClockKit `CLKComplication` via `WidgetConfiguration`)
| Family | Layout | Content |
|---|---|---|
| `.accessoryCircular` | Ring + glyph | whistle glyph, gold ring shows countdown progress to kickoff |
| `.accessoryCorner` | Curved text | `2h14m` + whistle, tint gold |
| `.accessoryRectangular` | 3-line | `NEXT GAME` / `Finbar's v Rovers` / `19:30 · Hackney` |
| `.accessoryInline` | One line | `⚽ Next game in 2h 14m` |
During a live match the complication flips to `1H 45’ · 2–1` (gold→green tint) so the face shows live
score. Tap → deep-links to Home or Live (if in-progress).

### 5.2 Smart Stack widget (watchOS 27 proactive)
```
┌────────────────────────────┐
│ ⚽ NEXT GAME        2h 14m │ gold countdown, mono
│ Finbar's  v  Rovers        │ titleM
│ 📍 Hackney Marshes · 19:30 │ captionS t2
│           [ Open ▸ ]       │ green pill
└────────────────────────────┘
```
- Uses `RelevanceConfiguration` keyed off `kickoff_at` so the Smart Stack **surfaces it automatically
  ~30–60min before kickoff** and while `is_in_progress`.
- In-progress variant: `LIVE · 1H 45’` red dot + `2–1` + `[ Resume ▸ ]`.
- TimelineProvider refreshes from a cached `get_my_next_assignment` payload; tap opens the relevant
  screen. Data shape is the resolver's `next` game object — no extra fetch needed for the widget.

---

## 6. APP ICON SET + COMPLICATION ASSETS

### 6.1 App icon concept
**A referee's whistle inside the IN·OR·OUT mark.** Composition: dark `#0A0A08` rounded-square field;
a single **Phosphor-thin whistle** glyph centred in `#F2F0EA`; a thin **split underline** beneath it —
left half `#3DDC6A` (IN/green), right half `#FF4040` (OUT/red) — the brand's in/out duality as a goal-
line. No gradient, no gloss. Reads as authority + sport at 1024px and as a clean silhouette at 40px.
Watch icons are circular-masked by the system, so keep the whistle within the central 80% safe circle.

watchOS App Icon sizes required (single `1024×1024` in an Icon asset catalog; system downscales, but
provide the full ladder for crispness):
- 1024×1024 (App Store / marketing)
- 108×108, 117×117, 129×129 (notification centre, varies by model)
- 196×196, 216×216 (home screen 41/45/49mm)
- 48×48, 55×55, 58×58 (notification + companion settings)
- 87×87, 100×100 (short-look + home secondary)
Supply as a single 1024 with the watchOS "single size" option in Xcode 16+ if you prefer; the ladder
above is the explicit fallback.

### 6.2 Complication assets
- **Monochrome SF Symbol** rendition of the whistle (tintable; faces recolour it) — provide a custom
  `whistle.thin` SVG symbol (Phosphor-thin) imported as an SF Symbol so it inherits face tint and the
  gold countdown ring. Provide `@2x`/`@3x`.
- Live-state glyph: `soccerball` (system) for the in-progress complication.
- Gauge/ring asset: use `Gauge`/`ProgressView` driven by countdown fraction — no static asset needed.

---

## 7. LIVE ACTIVITY + DYNAMIC ISLAND (iPhone, ActivityKit)

Driven by the existing realtime broadcast (`team_live`/`venue_live`); starts when the match goes live,
ends at full-time. Shows live HR/zone where the watch ref is tracking.

**Lock-screen / banner (expanded Live Activity):**
```
┌──────────────────────────────────────┐
│ ⚽ 1H  45’           Finbar's  2 – 1  │  period+clock left, score right
│                                Rovers │
│ 📍 Hackney Marshes    ❤︎168 Z4 ◉ LIVE │  venue · live HR/zone · live dot
└──────────────────────────────────────┘
```
Score halves carry the `#60A0FF`/`#FF6060` tint spine; period chip same tokens as the watch.

**Dynamic Island — compact:**
```
(leading) ⚽1H        (trailing) 2–1
```
**Dynamic Island — expanded (long-press):**
```
┌ leading ──────┐        ┌ trailing ─────┐
│ Finbar's      │        │  45’  1H      │
│ ⚽ 2          │        │  ❤︎168 · Z4   │
└───────────────┘        └───────────────┘
┌ bottom ──────────────────────────────┐
│ Rovers  1     ·   Hackney Marshes     │
└───────────────────────────────────────┘
```
**Dynamic Island — minimal (multi-activity):** the soccerball glyph, green tint when level changes; tap
expands. **Live HR/Zone** only renders when a watch ref session is active (else the HR slot is omitted,
not blanked).

`ContentState`: `{ clock, period, scoreA, scoreB, teamA, teamB, venue, hrBpm?, hrZone? }` — mirror the
watch's `ScoreHeader` model so one source drives both surfaces.

---

## 8. ACCESSIBILITY NOTES

### 8.1 Colour-blind-safe score & period cues (never colour-only)
- **Cards**: never signalled by colour alone — always glyph **shape + text**. Yellow = upright
  rectangle + "YC"/spoken "yellow card"; Red = rectangle + "RC". Second-yellow shows two stacked
  rectangles → red prompt. (Amber/red are also distinct in luminance, but text is the source of truth.)
- **Teams**: the 3pt spine colour (`#60A0FF`/`#FF6060`) is decorative; every team reference also
  carries text ("Team A", squad/team name, "(Rov)" on scorers).
- **Period**: chip always shows the **label text** ("1H", "ET") — the amber/purple/gold tint is
  secondary. HR zones show **"Z1…Z5" + minutes** alongside the colour bar.
- **Sync**: synced/pending/offline use **distinct glyphs** (`circle.fill` / spinning arrows /
  `wifi.slash`), not just green/amber/red.

### 8.2 VoiceOver labels (per control)
| Control | Label | Hint / value |
|---|---|---|
| Score header | "45 minutes 12 seconds. Score 2 to 1." | updates live, `.updatesFrequently` |
| Period chip | "First half" / "Half time" / "Extra time" / "Penalties" / "Full time" | — |
| Player row | "Team A number 7 J. Carter" | "+ has a yellow card" appended via badge.spoken |
| Goal button | "Record goal" | "Double-tap and hold for own goal" |
| Yellow / Red | "Yellow card" / "Red card" | — |
| Sub button | "Substitution" | "Opens substitution picker" |
| Sin-bin | "Sin bin" / row: "Sin bin, 1 minute 20 seconds remaining" | live countdown via `accessibilityValue` |
| Added time | "Added time, 3 minutes" | "Rotate Digital Crown to adjust" |
| FT confirm | "Confirm full time" | "Ends the match and your health tracking" |
| Decider stepper | "Team A penalties, 4" | "Rotate Digital Crown to adjust" |
| Sync dot | "Synced" / "Pending sync" / "Offline, saved on this watch" | — |
| Clock-controller badge | "You control the clock" / "Web assistant controls the clock" | — |
| Live HR | "Heart rate 168, zone 4" | `.updatesFrequently` |
| OPEN / START / RESUME | "Open game" / "Start match" / "Resume match" | the primary CTA |

### 8.3 Dynamic Type
- All text uses `Font.system(...)` → scales automatically. Honour up to `.xxxLarge` accessibility
  sizes; clock/score use `.minimumScaleFactor(0.7)` so they shrink rather than truncate.
- At the largest accessibility sizes, player rows reflow to **two lines** (number+badge on line 2);
  action dock stays fixed (icons don't scale past 1.3×) to preserve 44pt targets.
- Use `@ScaledMetric` for the player-row min height so it grows with type size but never below 44pt.

### 8.4 Targets & motion
- Every interactive control ≥ **44×44pt** (verified in §3 table). Action-dock buttons 52–56pt.
- Honour **Reduce Motion**: the Pre-match→Live "score scale-up" becomes a cross-fade; the live heart
  pulse stops; sync spinner becomes a static glyph.
- Always-On (`isLuminanceReduced`) layouts (§2 `[AO]` variants) keep clock+score legible at reduced
  luminance and throttle updates — also the lowest-power, highest-legibility state for low vision.

---

## OPEN QUESTIONS FOR THE ENGINEER

1. **`get_my_next_assignment` fields for the widget/complication** — does `next` include enough to
   render the Smart Stack (teams + venue + kickoff) without a second round-trip? The widget design
   assumes yes. Confirm `home_team`/`away_team`/`squad_name`/`venue_name` are always populated per
   context (casual fills `squad_name`+A/B; league fills `home_team`/`away_team`).
2. **Period length for "half-time approaching" haptic** — is configured period length exposed on the
   fixture state, or do we assume 45'? The pre-warning haptic (§4.3) needs it.
3. **Sin-bin duration** — fixed (e.g. 10min) or per-competition? The on-wrist countdown UI is built
   either way but the label/haptic timing depends on it.
4. **Live HR in Live Activity** — confirm the watch can push HR/zone into the iPhone `ContentState`
   over the realtime channel (or via WatchConnectivity → app → ActivityKit). Design omits the HR slot
   gracefully if not.
5. **Custom whistle SF Symbol** — OK to author + bundle a `whistle.thin` symbol (Phosphor-derived) for
   the complication tintability, vs. substituting the nearest system glyph? Affects icon + complication.
