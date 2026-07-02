# Handoff: Gaffer — the "in or out" in-app assistant launcher

## Overview
**Gaffer** is the tap-to-summon AI assistant for the *in or out* app (casual footballers, gym members, guardians, venue owners — one adaptive assistant for all roles). This handoff covers **Gaffer's on-screen presence**: the floating launcher that overlays the app, its idle/nudge/listening states, drag-to-move behaviour, and the chat panel it expands into. It is *not* the conversational back-end — only the launcher UI and its interactions.

The launcher is a glowing, frosted-glass "pebble" holding a luminous **?** mark. It floats over the app content, can be dragged out of the way, nudges the user with banter when it has something, and expands into a bottom-sheet chat on tap.

## About the design files
The files in `design_files/` are **design references authored in HTML** (a lightweight component runtime — `.dc.html` + `support.js`). They are prototypes that show the intended look, motion, and behaviour. **They are not production code to copy directly.**

Your task is to **recreate this launcher in the target codebase's own environment** — React/React Native, SwiftUI, Flutter, Vue, etc. — using its established component patterns, animation library, and theming system. If no front-end environment exists yet, pick the most appropriate one for the platform (the launcher is designed mobile-first but works on desktop web too) and build it there. Treat the HTML as a precise spec, not a source to port line-for-line.

Two colour variants are included:
- **`Gaffer Core Amber.dc.html`** — the chosen direction (warm gold). Build this one.
- **`Gaffer Core Green.dc.html`** — the earlier emerald variant, kept for reference only.

## Fidelity
**High-fidelity.** Colours, typography, spacing, radii, shadows, and animation timings are final and specified below. Recreate the launcher and chat panel pixel-accurately using the codebase's libraries. The surrounding "app" (greeting, THIS WEEK cards, bottom nav) in the mock is **placeholder context** to show Gaffer in situ — you do **not** need to build it; it stands in for the host app.

---

## Screens / Views

### 1. Launcher — idle (floating over app)
- **Purpose:** ambient presence; the user's entry point to Gaffer.
- **Element:** a 68×68px circle, `position: absolute`, floating above app content at `z-index: 10`. Default resting position: bottom-right, 14px inset from the right edge, ~54% down the screen height.
- **Composition (layered, all clipped to the circle except the halo):**
  1. **Frosted glass body** — `backdrop-filter: blur(5px) saturate(1.5) brightness(1.1)` over a subtle radial tint, so the app content behind it visibly blurs through. This is the key material: it must read as translucent glass, not a solid button.
  2. **Inner glow** — a soft radial light behind the mark that breathes (scale 0.84→1.12, opacity 0.78→1, 3.4s ease-in-out loop).
  3. **The "?" mark** — Hanken Grotesk 800, 34px, near-white with a coloured multi-layer glow (see tokens). Vertically nudged with `translate(-50%, -56%)`.
  4. **Rotating caustic** — a 1px arc (`border-top-color` only) spinning 360° every 7s, inset 6px, for a subtle "energy" shimmer.
  5. **Specular highlight** — a soft white blurred ellipse top-left (glass reflection).
  6. **Rim** — `inset` box-shadow ring for glass edge definition.
- **Whole orb** gently floats vertically (translateY 0→-4px, 5s ease-in-out loop).
- **Outer shadow/halo:** drop shadow + coloured outer glow so it lifts off the background (see `--orbsh`).

### 2. Launcher — nudge (has something to say)
- Triggered when Gaffer has an update (in the mock, on an ~8.5s idle timer for demo; in production, fire on a real event — see Interactions).
- **Adds:**
  - A **pulsing ring** expanding outward from the orb (scale 0.5→2.05, opacity 0.5→0, 2s loop).
  - A **notification dot** top-right of the orb: 13px circle in the accent colour with a glow, pulsing (scale 1→1.4, 1.5s loop).
  - A **banter bubble** above the orb: dark rounded rectangle (`#1a201d`, radius `14px 14px 4px 14px`), 188px wide, 12.5px text `#eef5f0`, springs in (translateY 8px→0 + scale 0.92→1, 0.35s). Example copy: *"Subs are due Friday — want me to sort it?"*
  - The **"?" does an energetic twirl** the moment the nudge fires: 720° rotation + slight scale-up (1→1.16→1) over 1.1s `cubic-bezier(.5,0,.2,1)`, instead of its ambient spin.
- **Ambient twirl:** even when idle (no nudge), the "?" does one calm 360° rotation every ~9s (keyframe holds still 0–84%, rotates 84–100%).

### 3. Launcher — listening (just tapped, before panel opens)
- On a genuine tap (not a drag), the orb briefly shows concentric **ripple rings** (same gRipple animation) to acknowledge the touch, then the chat panel opens.

### 4. Launcher — dragging
- On pointer-drag, the orb scales to **1.08** and follows the finger/cursor, clamped within the screen bounds (14px side/bottom inset, 46px top inset for the status bar).
- On release, it **snaps horizontally to the nearest edge** (left inset 14px or right inset `W - 68 - 14`) with a `transform .32s cubic-bezier(.22,1,.36,1)` spring. Vertical position is kept where dropped.
- The snapped position is **persisted** (localStorage key `gafferCorePos` = `{px, py}`) and restored on next load.

### 5. Chat panel (expanded)
- **Purpose:** the conversation surface Gaffer opens into.
- **Scrim:** full-screen `rgba(4,7,6,.45)`, fades in 0.3s; tap to dismiss.
- **Sheet:** bottom sheet, **64% of screen height**, radius `28px 28px 33px 33px`, frosted (`backdrop-filter: blur(22px) saturate(1.5)`) over `rgba(18,24,21,.74)` (dark) — the app cards blur through the top of it. Slides up from `translateY(112%)` to `0` over **0.42s `cubic-bezier(.2,.9,.3,1)`**.
- **Contents (top→bottom):**
  - Grab handle (38×4px, rounded, centered).
  - **Header row:** 30px Gaffer mini-orb (same glass + glowing "?"), name **"Gaffer"** (15px/700), subtitle *"here to help · always on"* (11px, accent colour, 600), and a circular ✕ close button top-right.
  - **Message area:** Gaffer's greeting bubble (align-left, radius `4px 16px 16px 16px`, card bg, 14px text) — e.g. *"Evening, Sam. Subs are due Friday and there's **3 unread** in Sunday League. Want me to settle the subs and catch you up?"* Each message rises in (translateY 10px→0, opacity 0→1, 0.4s).
  - **Suggestion chips:** wrapping row. Primary chip = solid accent fill with dark text (*"Settle the subs"*); secondary chips = translucent with light text (*"Catch me up"*, *"Who's in Thursday?"*). 13px, radius 20px, 9×14px padding.
  - **Input bar:** pill field (44px tall, radius 24px) with placeholder *"Message Gaffer…"* + circular 44px accent send button with a dark play-triangle.

---

## Interactions & Behavior
- **Tap vs drag:** distinguished by movement threshold. Pointer moves > 6px total → treated as a **drag**; otherwise release = **tap** → open chat. (Prevents accidental opens while repositioning.)
- **Drag bounds:** clamp x to `[14, W-68-14]`, y to `[46, H-68-14]`.
- **Edge snap on release:** if orb center-x < screen mid → snap left; else snap right. Persist to localStorage.
- **Open chat:** sets `open=true`; the orb is hidden while the panel is up (`showOrb = !open`).
- **Close chat:** tap scrim or ✕ → `open=false`; orb returns.
- **Nudge (production):** in the mock it's a demo timer (every ~8.5s while idle, auto-clears after 3s). In production, drive `mode='nudge'` from real events per role, e.g.:
  - Player: subs due, unread team chat, low numbers for a game, MOTM vote open.
  - Guardian: consent needed, pickup/schedule change, payment due.
  - Venue owner: new booking, no-show, low-occupancy slot, revenue summary.
  - Gym member: streak reminder, class starting, plan check-in.
- **Theme:** a Dark/Light toggle in the mock header flips CSS custom properties on the screen root (see Design Tokens → theming). The orb has **dedicated light-mode treatment** so it stays legible on light backgrounds (richer solid-emerald/amber fill + stronger halo + higher-contrast "?"), rather than the translucent dark-glass look used on dark backgrounds.
- **First-run hint:** a small pill *"Tap Gaffer to chat · hold to drag aside"* shows until first interaction, then hides.
- **Reduced motion:** respect `prefers-reduced-motion` — disable the ambient float/spin/twirl and the breathing glow; keep a static orb and instant (or short) panel transition.
- **Accessibility:** the orb is a button — label it e.g. `aria-label="Open Gaffer assistant"`; the notification dot should carry an accessible "has updates" state; the ✕ needs a label; hit target is ≥ 44px (orb is 68px ✓).

## State Management
State needed for the launcher component:
- `mode`: `'idle' | 'nudge' | 'listening' | 'dragging'`
- `px, py`: orb position (numbers, px within the screen)
- `snapping`: boolean (whether the edge-snap spring transition is active)
- `open`: boolean (chat panel visible)
- `theme`: `'dark' | 'light'`
- `hint`: boolean (first-run hint visible)
- Transient (non-render) drag data: pointer offset, start point, `moved` flag.

Derived per render:
- `showOrb = !open`
- `nudge = mode==='nudge' && !open`
- `qAnim` = twirl animation when nudging, else ambient spin.
- `scale = mode==='dragging' ? 1.08 : 1`
- `snapTransition` = spring when `snapping`, else a quick `.12s ease-out` follow.

Persistence: `localStorage['gafferCorePos'] = JSON.stringify({px, py})` on snap; read + clamp on mount.

## Design Tokens

### Accent (chosen: Amber)
- Primary amber: `#f5a623`
- Amber deep / text-on-app: `#c9851e`
- "?" mark (dark mode): `#fff5e6` with glow layers `rgba(255,224,160,.95)`, `rgba(245,166,35,.85)`, `rgba(224,150,30,.6)`
- Orb outer glow (dark): `0 0 28px rgba(224,150,30,.28)` + `0 0 0 1px rgba(245,166,35,.3)` + `0 10px 24px rgba(0,0,0,.45)`
- **Light-mode orb** fill: `radial-gradient(125% 125% at 30% 22%, rgba(255,208,116,.94), rgba(244,158,30,.92) 46%, rgba(206,118,18,.94) 86%)`
- **Light-mode orb** shadow/halo: `0 0 0 1px rgba(214,128,20,.55), 0 10px 22px rgba(150,90,20,.34), 0 0 24px rgba(255,182,62,.85), 0 0 52px rgba(255,170,52,.45)`
- **Light-mode "?"**: `#fffaf0`, shadow `0 1px 2px rgba(110,55,0,.55), 0 0 10px rgba(255,226,150,.7)`

### Accent (alternate: Emerald — see green file)
- Primary: `#34e0a1` · deep `#1f9d5f` · glow greens `rgba(150,255,210,…)`, `rgba(52,224,161,…)`, `rgba(25,195,125,…)`

### Neutrals & theming (CSS custom properties on the screen root)
Dark (default) → Light:
- `--scr1` bg top: `#141a17` → `#f1f4f0`
- `--scr2` bg bottom: `#0a0d0b` → `#e3e8e3`
- `--t1` text primary: `#f2f5f1` → `#16231d`
- `--t2` text secondary: `rgba(255,255,255,.5)` → `rgba(20,34,27,.58)`
- `--t3` text tertiary: `rgba(255,255,255,.32)` → `rgba(20,34,27,.4)`
- `--card`: `rgba(255,255,255,.04)` → `rgba(255,255,255,.72)`
- `--cbd` border: `rgba(255,255,255,.06)` → `rgba(20,44,32,.1)`
- `--panel` sheet bg: `rgba(18,24,21,.74)` → `rgba(244,247,244,.82)`
- `--field` input bg: `rgba(255,255,255,.06)` → `rgba(20,44,32,.06)`
- Warning accent (used by "DUE FRI" pill): amber `#c98b1e` on `rgba(224,179,65,.16)`
- Confirmed pill: green `#1f9d5f` on `rgba(52,224,161,.14)`

### Typography
- Family: **Hanken Grotesk** (400/500/600/700/800). Mono labels: **Space Mono** (700), letter-spacing 1.5px, uppercase.
- Orb "?": 800 / 34px (mini orb in header: 15px).
- Greeting: 700 / 29px / -1px tracking. Body: 14px. Card title: 14.5px/600. Chip: 13px.

### Sizing / radius / shadow
- Orb: 68×68 circle. Notification dot: 13px. Banter bubble: 188px wide.
- Chat sheet height: 64% of screen; radius `28/28/33/33`.
- Card radius: 16px; chip radius: 20px; input pill radius: 24px.
- Device mock: 380×780 screen, 33px screen radius inside a 42px bezel (mock only).

### Motion (keyframes & timings)
- `gFloat` orb bob: translateY 0→-4px, 5s ease-in-out infinite.
- `gCore` inner glow breathe: scale 0.84→1.12 / opacity 0.78→1, 3.4s.
- `gGlow` "?" opacity 0.82→1, 3.4s.
- `gQSpin` ambient "?" spin: still 0–84%, 360° by 100%, 9s ease-in-out infinite.
- `gQTwirl` nudge "?" twirl: 720° + scale 1→1.16→1, 1.1s cubic-bezier(.5,0,.2,1).
- `gSpin` caustic arc: 360°, 7s linear.
- `gRipple` listening/nudge rings: scale 0.5→2.05 / opacity 0.5→0, ~1.7–2s.
- `gDot` notification dot: scale 1→1.4 / opacity 1→0.6, 1.5s.
- `gPop` banter bubble: translateY 8px→0 + scale 0.92→1, 0.35s.
- `gSheet` panel: translateY 112%→0, 0.42s cubic-bezier(.2,.9,.3,1).
- `gScrim`: opacity 0→1, 0.3s. `gRise` messages: translateY 10px→0 + fade, 0.4s.
- Drag follow: `transform .12s ease-out`; snap: `transform .32s cubic-bezier(.22,1,.36,1)`; drag scale 1.08.

## Assets
No external images. Everything is CSS (gradients, shadows, blur) + the typographic **?** glyph. Fonts via Google Fonts (Hanken Grotesk, Space Mono) — swap for the codebase's equivalent brand fonts if different. The mock's app content (cards, avatars, nav) is placeholder and not part of the deliverable.

## Files
In `design_files/`:
- `Gaffer Core Amber.dc.html` — **the design to build** (amber, dark + light, drag, nudge, chat panel).
- `Gaffer Core Green.dc.html` — emerald alternate, reference only.
- `support.js` — the runtime the `.dc.html` prototypes use to render (so you can open them in a browser). Not needed in production.

To preview a reference: open the `.dc.html` file in a browser (it loads `support.js` alongside). Screenshots of the key states are in `screens/`.
