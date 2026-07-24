# Design Brief — In or Out loading screen

**For:** claude design
**Target file:** `apps/inorout/src/views/LoadingScreen.jsx` (single source of truth — every loading state in the app renders this one component)
**Status quo:** black screen, a 48px `⚽` emoji, optional "Loading…" text beneath it

---

## What this is

The in-app loading splash the app paints **while auth + route data resolve**. It is React in the **web bundle**, NOT the native iOS `LaunchScreen` storyboard. That means:

- It can be redesigned and shipped to production with **no App Store resubmission / review**.
- The native splash (a static branded PNG) shows *first* for ~400ms, then this hands over. So this screen fills the gap between native-splash-hide and app-ready.

Deliver a redesign of this one component. Keep it a single self-contained file.

---

## The two variants (must both be supported)

| Variant | When | Current |
|---|---|---|
| Bare | most route gates | ball only |
| Labelled | landing / cold data load | ball + "Loading…" text |

Current API — keep this shape (a redesign may extend it, but these call sites must keep working):

```jsx
<LoadingScreen />                        // bare
<LoadingScreen label="Loading..." />     // with caption
```

---

## HARD constraints (non-negotiable — design will be rejected if it breaks these)

1. **No external assets / no network.** This paints *because* the network hasn't returned. No image fetches, no Lottie JSON, no GIF, no Google-hosted anything. **Pure CSS and/or inline SVG only.** Animation via CSS keyframes.
2. **Featherweight.** It's in the critical-path JS bundle — every KB delays first paint. Inline SVG + CSS is effectively free; anything heavier is not worth it. No new npm dependencies.
3. **No dynamic/personalised content.** No name, no team, no fixture — that data does not exist yet at this point in the lifecycle. Anything that varies (e.g. tips) must be a **hard-coded array in this file, picked client-side**.
4. **No ads / promo.** Apple guideline 2.3 forbids advertising on a launch/loading surface, and it reads cheap. Branding is fine; ad units are not.
5. **Duration is unpredictable** — sometimes <150ms (warm), sometimes several seconds (cold / slow network). Design must look right both as a *flash* and as a *sustained* wait. No layout that only makes sense after N seconds.
6. **Font flash.** Bebas Neue / DM Sans load async; on a cold start this screen can paint before they arrive. Any text must survive a system-font fallback frame — keep text minimal.

---

## Brand tokens available (import, don't hardcode)

- Colours: `import { colors as C } from "@platform/core"` — use `C.bg` (near-black `#0c0c0c`), `C.muted`, etc. Do **not** invent hexes. The only two hardcoded hexes allowed anywhere in the app are `#60A0FF` (Team A) and `#FF6060` (Team B) — and CSS variables can't be used inside SVG fill/stroke, so use those hex literals or inline `style` there.
- Type: Bebas Neue for headings/numbers, DM Sans 400 for body.
- Icons: Phosphor, `weight="thin"`.
- Aesthetic: dark, minimal, sporty. The ball is the brand motif — keep a ball reference unless you have a strong reason not to.

---

## What to design

**Core (required):** the loading state itself — a motion treatment for the ball (bounce / spin / pulse) or a tasteful branded alternative, plus the caption styling for the labelled variant. Must feel alive (signals "working," not "frozen") while staying calm enough to flash for 150ms without jarring.

**Optional, high-value (design if you want to propose them — flag as optional):**
- **Slow-load state.** After ~4s, swap the caption to a reassuring line ("Still working — check your connection"). Turns a silent hang into an honest state. This is the single most useful upgrade; a visual/copy treatment for it is welcome.
- **Rotating hints/tips.** A bundled, client-side-random tip under the ball ("Tap a player's name for their stats", etc.). Onboarding value. If proposed, provide 5–8 starter tips.
- **Match-day / seasonal ball variant.** Cheap brand delight if it fits.

**Explicitly out of scope:** "What's new"/changelog (belongs in a post-load modal, not here); forced minimum display time.

---

## Deliverable

A drop-in replacement for `LoadingScreen.jsx` (or a visual spec precise enough to build from): markup + CSS-in-JS/keyframes, both variants working, tokens imported not hardcoded, zero external fetches. If you add the slow-load or tips behaviour, keep the existing `<LoadingScreen />` / `<LoadingScreen label="…" />` call signatures valid so the 13 existing call sites need no change.
