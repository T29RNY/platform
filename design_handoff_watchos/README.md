# Handoff: IoO Ref — watchOS

## Overview
A watchOS app for football (soccer) match officials, designed **watch-first**: the watch is the primary match-day tool for a sideline **assistant referee**, with the phone as a secondary/companion device. The referee runs the entire fixture from the wrist — clock, score, cards, substitutions, sin bins, period control, and the match log — with every core action reachable in one or two taps.

Target hardware: **Apple Watch Ultra (49 mm)** as the primary canvas (it has the programmable Action button and the biggest screen), with **Apple Watch Series (45/46 mm)** supported as a smaller secondary size. The design leans hard into watch-native input: **Digital Crown**, **Action button**, **Double-tap**, and **haptics**.

The app is an extension of an existing phone product ("IoO Ref") and reuses its broadcast-dark teal design language, re-tuned for an OLED wrist display (true-black background, oversized tabular numerals, large hit targets).

---

## About the Design Files
The files in `design_files/` are **design references created in HTML/React (via Babel-in-browser JSX)** — prototypes that show the intended look, layout, and behavior. **They are not production code to ship.**

The task is to **recreate these designs natively in watchOS** — almost certainly **SwiftUI** (the standard, and only sensible, choice for a modern watchOS app). Use SwiftUI's native components, layout system, `Digital Crown` APIs (`.digitalCrownRotation`), `WKInterfaceDevice` haptics, the Action button API (`AppIntent` + accessory), and watchOS navigation patterns. Treat the HTML as the **visual + interaction spec**, not as markup to port.

The HTML prototype is presented on a pan/zoom "design canvas" (`IoO Ref — watchOS.html`). Each watch screen is a React component; the canvas (`design-canvas.jsx`) is only a presentation harness and is **not** part of the product — ignore it when implementing.

---

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, glyphs, and interaction intent are all specified. Recreate the UI faithfully using native SwiftUI controls. Exact hex values, type sizes, and radii are listed below and in `watch/watch-os.css` (CSS custom properties at the top of the file are the source of truth for tokens).

> **One note on scale:** the prototype is authored at ~2× the physical pixel dimensions of the watch (the Ultra artboard is 410×502 with px sizes to match), so it can be inspected on a desktop canvas. **Treat all px sizes as relative/proportional**, not literal points. Use the *relationships* (clock is the dominant element, body text is comfortably legible at arm's length, hit targets are generous) and re-derive concrete point sizes for the real 49 mm / 45 mm displays using Apple's watchOS type ramp. Minimum tap target: 44×44 pt.

---

## Design Tokens
Source of truth: top of `design_files/watch/watch-os.css`.

### Colors
**Surfaces (true-black OLED base):**
- `--w-black` `#000000` — screen base; bleeds into the bezel
- `--w-bg` `#07090C`
- `--w-surface` `#141821` — cards / list rows
- `--w-surface2` `#1C212B` — secondary buttons, shirt tokens
- `--w-raised` `#262C38` — raised buttons
- `--w-hair` `#2A313D` / `--w-hair2` `#3A4150` — hairline borders (used as 1.5px inset rings)

**Text:**
- `--w-txt` `#F4F6FA` — primary
- `--w-txt2` `#AEB7C4` — secondary
- `--w-txt3` `#717B8A` — tertiary / labels

**Brand accent (teal):**
- `--w-accent` `#19D8C4` (primary) · `--w-accent-b` `#3DF0DC` (bright/gradient top) · `--w-accent-d` `#0E9A8C` (deep/gradient bottom)
- `--w-accent-ink` `#04201D` — ink/text ON the teal accent (e.g. label inside primary buttons)
- `--w-glow` `rgba(25,216,196,0.45)` — accent glow for shadows

**Semantic / event colors:**
- `--w-yellow` `#F5C518` — yellow card
- `--w-red` `#FF4B44` — red card / send-off / full-time confirm
- `--w-amber` `#FBA63A` — sin bin
- `--w-blue` `#5B8CFF`
- `--w-green` `#36C46E` — substitution "on" / bring-on
- `--w-og` `#F0743C` — own goal

**Team colors (sample data):** Riverside `#3B74E8` (home, navy/blue) · Rothwell `#E64034` (away, red). Real team colors come from match setup.

### Typography
Two families (swap for native equivalents — SF Pro / SF Compact Rounded are good watchOS analogs; if you keep these, bundle the fonts):
- **Display** `--w-disp`: **Archivo** (weights 700–900). Used for clock, scores, names, numbers. Tight tracking (`-0.01em` to `-0.02em`). Always **tabular-nums** for any number that changes (clock, scores, timers).
- **UI** `--w-ui`: **Hanken Grotesk** (weights 500–800). Used for labels, buttons, body.

Type roles (relative scale — re-derive for device):
- **Match clock** — display 800, the single largest element on the live screen
- **Score numerals** — display 800, tabular
- **Player / team name** — display 800
- **Eyebrow labels** — UI 800, UPPERCASE, letter-spacing `0.12em`, color `--w-txt3`
- **Button label** — UI 800
- **Pills / meta** — UI 800, UPPERCASE, letter-spacing `0.06em`

### Radii
- Screen-content cards / sheets: ~22px
- Buttons (pill): ~26–30px
- Circular dock buttons: full circle (72px standard, 92px primary)
- Shirt token: ~0.32× of its size (superellipse-ish rounded square)
- Small chips/strips: ~13px

### Shadows / effects
- Primary (teal) button: `0 10px 26px var(--w-glow)`
- Accent glow on key glyphs: `drop-shadow` / `box-shadow` using `--w-glow`
- Color bars beside team names: `box-shadow: 0 0 12px -2px currentColor` (subtle bloom)
- "Aura": a soft radial teal glow behind hero content (`.w-aura`) — gate behind reduced-motion / keep subtle
- Inset hairline borders via `inset 0 0 0 1.5px <hair/accent>` rather than real borders

### Motion
- Button press: `transform: scale(0.96)` (circles `0.92`), ~80ms
- Live pulse dot: 1.8s expanding ring (`@keyframes wpulse`)
- Honor `prefers-reduced-motion` (→ on watchOS, respect Reduce Motion): disable pulsing/aura.

---

## Watch case chrome (prototype only — do NOT build)
`frame.jsx` draws a realistic Apple Watch bezel (titanium Ultra / graphite Series, Digital Crown, side button, orange Action button, mic vent). **This is presentation scaffolding to make the mocks read as a real watch.** The OS draws the real bezel — ignore `Watch`, `DIMS`, `wrapSize` entirely. Only the **screen content** (everything inside `.w-screen` → `.w-scr`) is the product.

---

## Screens / Views

> Sample match used throughout: **Riverside FC (RIV, home, blue) 2–0 Rothwell Town (ROT, away, red)**, U18 League. Squad/player names are placeholder data.

### 1. Kickoff gate (`PreMatch`) — `screenshots/01-kickoff-gate.png`
- **Purpose:** Pre-match confirmation + start the clock.
- **Layout:** Vertical, space-between. Top: brandmark (teal rounded square w/ whistle glyph) + competition eyebrow ("U18 League · Rd 12"). Middle: two team lines (color bar + full name + "Home/Away · color" subtitle) separated by a "VS" divider. Bottom: "Kicks off 14:15 · unlocked" status, then a large primary **Hold to start** button with a fill-progress overlay and a hint "Press & hold 3s · or Action button".
- **Interaction:** Press-and-hold (3s) to start, OR press the **Action button**. Hold shows radial/linear progress. On start → haptic + navigate to Live home.

### 2. Live match home (`LiveHome`) — `screenshots/02-live-home.png`  ⭐ the glance screen
- **Purpose:** The screen the ref looks at for 90 minutes. One glance = period, clock, score; logging is one tap.
- **Layout (top→bottom):**
  1. **Period pill** (centered) — teal "live" pill with pulsing dot: "1st Half".
  2. **Sin-bin strip** (only when a bin is active) — full-width amber strip, ~40px tall, rounded 13px. Left-aligned: sin-bin glyph + "Sin bin · ROT #14", right: tabular timer "1:32" + chevron. A depleting amber fill (`.w-binstrip-fill`, width = % remaining) sits behind. **Tappable** → opens Sin-bin detail. Stacks if >1 bin runs. *This is deliberately a strip, not a takeover, so logging is never blocked while a bin runs.*
  3. **Match clock** — dominant, centered, tabular. Subtext eyebrow "+2 MIN ADDED" in teal.
  4. **Score row** — `RIV |bar| 2  –  0 |bar| ROT`, color bars flanking, big tabular numerals, dimmed en-dash.
  5. **Dock** — three items: **Pause** (circle, secondary), **Log** (large teal primary circle, "+"), **Period** (circle, whistle). Labels under each.
- **Hardware mapping shown:** an orange tab on the left edge labels the **Action button → Goal** (fastest possible goal log). **Crown** scrolls; **Double-tap** = add stoppage / confirm goal (see Interactions).
- **Top-right:** system time of day in teal.

### 3. Half-time / period control (`HalfTime`) — `screenshots/03-half-time.png`
- **Purpose:** End-of-period moment + start next period.
- **Layout:** Centered. "END OF / Half-time" (display), "45:00 +2" tabular. Score row. An amber "LOGGING PAUSED" pill. Large primary **Start 2nd half** button (play glyph). Reuse for HT, FT-of-normal-time, extra-time periods.

### Event logging flow — **Action → Team → Player** (this order is intentional)
A ref perceives *what* happened before *who*, so the flow leads with the action.

#### 4. Step 1 · What happened? (`ActionSheet`) — `screenshots/04-log-action.png`
- **Purpose:** Entry point for logging. No player selected yet.
- **Layout:** Header = match minute (teal, tabular "23'") + eyebrow "What happened?". A 2-column grid of action cells:
  - **Goal** (teal-tinted, accent ring, goal dot glyph) · **Yellow** (yellow card glyph)
  - **Red** (red card glyph) · **Sub** (sub arrows glyph)
  - **Sin bin** (amber, wide) · **Own goal** (orange, wide)
- **Interaction:** Tap an action → go to Step 2 (team). Cells are large (≥ ~½ screen width, generous height).

#### 5. Step 2 · Which team (`TeamSelect`) — `screenshots/05-log-team.png`
- **Layout:** Header carries the chosen action ("Goal · which team?" with the goal glyph). Two large full-width team buttons (color bar + full name + "Squad of 16" + chevron). Cancel button at the bottom.
- **Interaction:** Tap team → Step 3.

#### 6. Step 3 · Which player — Digital Crown (`PlayerPick`) — `screenshots/06-log-player-crown.png`  ⭐ Crown
- **Purpose:** Pick the shirt number. **The key small-screen solution.**
- **Layout:** Header "RIVERSIDE FC · SCORER?" (action-aware). A vertical **Crown-driven picker**: the focused player is a large centered card (shirt token with accent ring + name + role); the player above and below are dimmed/smaller as preview. Right edge: **Crown scroll indicator** (teal thumb). A "Turn ⟳" hint sits next to the physical Crown. Bottom: primary **Choose #9 Cole ›**.
- **Interaction:** **Digital Crown rotates** through the squad (haptic detent per player). Tap focused card or the Choose button to confirm. This is the canonical pattern — reuse it anywhere a player/number is chosen.

#### 7. Card confirmation (`CardConfirm`) — `screenshots/07-card-confirm.png`
- **Purpose:** Confirm a card before it's committed.
- **Layout:** Full-bleed moment. Large card glyph (yellow), "Yellow" in card color, then player (shirt token + name + "team · minute"). Bottom: **Undo** (secondary) + **Confirm** (teal primary, wider). Strong confirm haptic on commit.

#### 8. Second yellow → red (`SecondYellow`) — `screenshots/08-second-yellow-red.png`
- **Purpose:** Guard rail when booking an already-booked player.
- **Layout:** Amber warning eyebrow "Second yellow", yellow-card → red-card glyph transition, copy: "#8 Mendes is already booked / This logs a 2nd yellow **and a red** — he is sent off." Bottom: **Cancel** + **Send off** (red). Triggered automatically when the picked player already has a yellow.

#### 9. Substitution — Crown (`Substitution`) — `screenshots/09-substitution-crown.png`
- **Purpose:** Log off→on.
- **Layout:** Header "Substitution · {team}". **OFF** row (red down-arrow + player going off). **ON** picker (green-ringed card) using the same Crown picker pattern to choose the incoming player from the bench. Primary **Confirm sub**.
- **Interaction:** Crown selects the incoming player; confirm commits both legs.

### In-play tools

#### 10. Sin-bin detail / manage (`SinBin`) — `screenshots/10-sinbin-detail.png`
- **Purpose:** Reached by tapping the live-home sin-bin **strip**. Manage one running bin.
- **Layout:** Back chevron + "Sin bin" amber pill at top. Large **countdown ring** (amber, glowing, depletes clockwise) with tabular "1:32 / REMAINING" centered. Player (shirt token amber ring + name + "team · 2 min"). Bottom: **End early** + **Match** (back to live home — proves you can leave the timer running and keep logging).
- **Note:** Multiple concurrent bins should each be a strip on the live home; this detail view manages the tapped one.

#### 11. May-return alert (`MayReturn`) — `screenshots/11-may-return.png`
- **Purpose:** Fires (with haptic) when a sin bin expires.
- **Layout:** Amber "May return" pill, big amber sin-bin badge, "#14 Oakes / Sin bin complete · 2:00 served". Bottom: **Keep off** + **Bring on** (green).

#### 12. Match log / timeline (`MatchLog`) — `screenshots/12-match-log.png`  ⭐ Crown scroll
- **Purpose:** Running list of all events; undo.
- **Layout:** Header "MATCH LOG" + current minute. Crown scroll indicator on the right. Rows: minute (tabular) · event glyph · "Type · #N Name" with team subtitle · **sync dot** (green = synced, amber pulsing = pending sync to phone/cloud). Bottom: **Undo last event** (teal).
- **Interaction:** Crown scrolls the list. Each row tappable for detail/edit.

### Result

#### 13. Full time (`FullTime`) — `screenshots/13-full-time.png`
- **Purpose:** Final whistle locks the report.
- **Layout:** Whistle glyph + "FULL TIME" eyebrow (teal). Result rows (winner full opacity, loser dimmed): "RIV 2 / ROT 1" with color bars and big tabular scores. Bottom: full-width **Confirm full time** (red, whistle glyph). Confirming locks the match and syncs.

### Series 45 mm comparison — `screenshots/14..16`
Identical screens on the smaller graphite case: **Live home**, **Action sheet**, **Sin-bin detail**. Same design system; the only differences are the physical case (no Action button on non-Ultra → the Goal shortcut moves to Crown-press or stays in the dock) and slightly rounder screen corners. Layouts reflow but keep the same hierarchy.

---

## Interactions & Behavior

### Hardware input (lean in — this is a differentiator)
- **Digital Crown:** primary selector for player/number pickers (squad scroll), substitution incoming player, and scrolling the match log. Use haptic detents per item.
- **Action button (Ultra):** **Log Goal** — fastest path. Implement as an `AppIntent` bound to the Action button.
- **Double-tap (Series 9+/Ultra 2):** hands-free confirm — e.g. add a minute of stoppage time, or confirm the focused action — while eyes stay on play.
- **Side button / Crown press:** standard OS behavior; don't override destructively.
- **Haptics — design a small "haptic language"** so the ref reads events by feel without looking: distinct patterns for goal-confirmed, card-committed, sin-bin expired (may-return), half-time approaching, full-time. Use `.notification`/`.success`/`.directionUp` etc.; consider custom patterns.

### Navigation flows
- Kickoff gate → (start) → Live home.
- Live home **Log** → Action → Team → Player(Crown) → (Card/Sub) confirmation → back to Live home.
- Live home **Action button** → Goal → Team → Player → quick confirm.
- Live home sin-bin **strip** → Sin-bin detail → back to Live home (timer keeps running).
- Sin-bin expiry → May-return alert (interrupts as a notification-style sheet) → resolve → back.
- Live home **Period** → Half-time → Start next period.
- (From a period-end / dedicated end action) → Full time → confirm → locked summary.

### States to handle
- **Clock:** running / paused / stoppage (added time) / between periods.
- **Logging paused** during half-time (amber pill); re-enabled on next period start.
- **Sin bins:** zero / one / many concurrent (each = a strip); per-bin countdown; expiry alert.
- **Second-yellow auto-detection** when booking a booked player.
- **Sync:** per-event synced vs pending (sync dots) to the companion phone/cloud.
- **Confirm/undo:** card, sub, and full-time are confirmable; match log supports undo-last.

---

## State Management
Model the match as a single source of truth (e.g. an `@Observable` `MatchModel`):
- `homeTeam`, `awayTeam` (name, abbreviation, color, squad: [shirtNo, name, role, onPitch, booked])
- `period` (enum: preMatch, firstHalf, halfTime, secondHalf, … fullTime), `clock` (elapsed, addedTime, running)
- `score` (home, away)
- `events: [Event]` — each: id, minute, type (goal/ownGoal/yellow/red/secondYellow/sub/sinBin), teamRef, playerRef(s), syncState (synced/pending)
- `sinBins: [SinBin]` — playerRef, team, duration, startedAt, remaining (derive via timer), state (running/expired/ended)
- Derived: isLoggingEnabled (false at half-time), playerIsBooked(playerRef), activeSinBinCount
- Triggers: Action button intent → start goal-log; Crown rotation → move picker focus; sin-bin timer tick → update strip + fire expiry alert; confirm actions → append event + haptic + mark pending-sync.

Persist locally (the match must survive app backgrounding / wrist-down). Sync events to the phone via Watch Connectivity when reachable; show pending state otherwise.

---

## Assets
- **No bitmap assets.** All glyphs are crafted inline SVG in `frame.jsx` (whistle, goal dot, card, sub arrows, sin-bin clock, play/pause, check, undo, chevron, plus, flag, warning). Recreate as **SF Symbols where a good match exists** (e.g. `pause.fill`, `play.fill`, `checkmark`, `arrow.uturn.backward`, `chevron.right`, `plus`, `exclamationmark.triangle`) and as small custom `Shape`/SVG for the football-specific ones (card rectangle, goal dot, sub up/down arrows, sin-bin stopwatch).
- **Fonts:** Archivo (display) + Hanken Grotesk (UI) via Google Fonts in the prototype. For native, prefer **SF Pro Rounded / SF Compact** to match watchOS, or bundle the two families if brand consistency with the phone app is required.
- **Team colors / squads:** placeholder sample data; real values come from match setup / the phone app.

---

## Files
In `design_files/`:
- `IoO Ref — watchOS.html` — entry; mounts the pan/zoom canvas (presentation only).
- `watch/watch-os.css` — **design tokens + all screen styling** (source of truth for colors/type/spacing).
- `watch/frame.jsx` — watch case chrome + crafted SVG glyphs + shared atoms (`TopTime`, `Pill`, `ScoreRow`, `CrownInd`, `Shirt`). Case chrome is prototype-only; glyphs/atoms are the spec.
- `watch/screens-a.jsx` — `PreMatch`, `LiveHome`, `TeamSelect`, `PlayerPick`, `ActionSheet` (+ sample squad/team data).
- `watch/screens-b.jsx` — `CardConfirm`, `SecondYellow`, `Substitution`, `HalfTime`, `SinBin`, `MayReturn`, `MatchLog`, `FullTime`, countdown `Ring`.
- `watch/board.jsx` — lays the screens onto the canvas (presentation only).
- `design-canvas.jsx` — the pan/zoom harness (presentation only — ignore).

In `screenshots/` — 16 hi-res reference PNGs (13 Ultra screens + 3 Series), numbered to match the screens above.

## How to view the prototype
Open `design_files/IoO Ref — watchOS.html` in a browser (needs internet for the React/Babel/font CDNs). Pan = drag, zoom = scroll/pinch, and click any artboard's expand control to view a screen full-screen.
