# Handoff: LetTrack Marketing Site (Home + Security)

## Overview

A two-page marketing site for **LetTrack**, a UK rental-compliance platform serving landlords, agencies, tenants, and contractors. The design positions LetTrack as a calm, premium, AI-assisted compliance tool — built around the Renters' Rights Act 2025 — and respects strict accuracy rules on what can be claimed about the product's current security posture.

Two pages:

1. **LetTrack Home.html** — the marketing home, with hero, live mission-control demo, AI core, onboarding flow, platform features, audience cards, security teaser, pricing, and final CTA. Includes an audience selector (Agency / Landlord / Tenant) that morphs hero copy.
2. **LetTrack Security.html** — a public `/security` page with the full breakdown of shipped security controls and pre-launch roadmap, audience-specific framing, and self-assessed posture summary.

The marketing rhythm (top→bottom) is intentionally **see it work → it's easy to start → AI under the hood → everything in one place → it's for you → it's safe → start free → go**.

## About the Design Files

**The HTML/JSX/CSS in this bundle are *design references*, not production code.** They are React-via-CDN prototypes that demonstrate the intended look, layout, copy, motion, and interactions. The task is to **recreate these designs in the target codebase's existing environment** — likely Next.js / React with the project's existing component library, styling system (Tailwind, CSS Modules, Linaria, vanilla extract, etc.), and routing — following its established patterns.

Do **not** copy the JSX wholesale: it relies on CDN Babel, inline `<script type="text/babel">`, no module system, and a fixed-name shared `styles` namespace. Treat it as visual + behavioral spec, then implement properly in the production app.

## Fidelity

**High-fidelity.** Exact colors, typography, spacing, motion, and copy are intentional. Match them. Where the prototype uses Inter via Google Fonts, the production app should use the same family (or whatever the design system specifies if it already has one set).

## Page 1: Home (`LetTrack Home.html`)

### Section order (top → bottom)

| # | Component | DOM id / class | Purpose |
|---|---|---|---|
| 1 | Nav | `nav.mk` | Sticky top nav with brand, links, sign-in / get-started |
| 2 | Hero | `.home-hero` | Eyebrow → activity ribbon → audience selector → headline → primary CTA → reassurance |
| 3 | Mission Control stage | `.stage-wrap#mission` | Side-by-side dashboard mock + 3D canvas + streaming detection log |
| 4 | Onboarding | `.onb-section#onboard` | "Drop your docs" — left: animated extracted-doc mock; right: 4 numbered steps |
| 5 | AI core strap + Stats | `.stats-section#ai` | Pitch + 4 stat cells |
| 6 | Platform | `.plat-section#platform` | 6 benefit tiles (messages, maintenance, mortgage prep, finance, timeline, audit) |
| 7 | Audiences | `#audiences` | 3 cards (Agency / Landlord / Tenant) with bullet benefits |
| 8 | Trust / Your data | `.trust-section#data` | 4 plain-English security tiles + link to security page |
| 9 | Pricing | `.price-section#pricing` | 3 cards (Tenants free · Landlords 60d trial *highlighted* · Agencies 60d trial) |
| 10 | Final CTA | `.final-section` | Restated value + 2 buttons |
| 11 | Footer | `footer.mk` | Brand, foot links incl. **Security**, copy |

### Hero details

```
EYEBROW (rounded pill, white bg, green dot):
  "● BUILT FOR THE RENTERS' RIGHTS ACT 2025"

ACTIVITY RIBBON (live ticker, see Interactions):
  [LIVE] 22 Park Avenue · deposit protected with DPS · PROTECTED

PROMPT: "Are you a landlord, agency, or tenant?"

AUDIENCE SELECTOR (segmented pill, dark ink active):
  [ Agency ]  [● Landlord ]  [ Tenant ]

H1 (changes per audience, gradient on 2nd line):
  Landlord → "Less paperwork. / More rent."
  Agency   → "Run your book / on autopilot."
  Tenant   → "Your home, / in your hands."

SUB COPY (per audience, see app.jsx > AUDIENCES dict)

CTA: [ Start 60 days free → ]  (per-audience label)

REASSURE: ✓ 60 days free for landlords & agencies  ✓ Free forever for tenants & contractors  ✓ No card to start
```

### Mission Control stage

A bordered card with three rows:
- **Telemetry strip** (mono small-caps): LIVE · PORTFOLIO 12 · UPRN 100023336956 · 53.8008°N 1.5491°W · RISK_INDEX 0.06 · LAST_SCAN 2s · ENGINE v1·RRA2025
- **Two-column body**: 
  - Left (`.dash`) = simulated landlord dashboard for "14 Maple Road, Leeds · LS6 2AB" with: compliance ring + 79% score + 4 mini-tiles (Tenancies, To review, Needs action, Renewals) + obligation stack (5 rows with status pills)
  - Right (`.scan-side`) = a wireframe/point-cloud house drawn by `house-canvas.jsx` (HTML5 canvas) + a streaming detection log (`DetectionLog` component) that pushes a new entry every 1.4s with a blinking caret

### Atlas (floating ambient navigator)

A small **glass orb** lives fixed at bottom-right (32px from edges, 18px on mobile). It has:
- A breathing pulse animation
- An internal needle that rotates to point at the section currently in view (driven by scroll position vs section IDs)
- A "/" hint on hover
- Tap (or press `/` key) to bloom into a **diagonal cascade of 8 pills** rising up-and-left from the orb, each a glass capsule with icon + section label. Click any pill to smooth-scroll to that section. Active section pill is dark-filled.
- Escape or click-outside closes

Sections (in cascade order, matching page top-to-bottom):
`Start → See it work → Onboard → AI core → Platform → For you → Your data → Try free`

### Footer link to Security

Footer must include a `Security` link pointing to `/security` (or whatever route the production app uses).

## Page 2: Security (`LetTrack Security.html`)

### Section order

1. Nav (same as home, with "Security" active)
2. Hero:
   - Back-to-home pill + eyebrow "● SECURITY & DATA"
   - H1: "Safe, in plain English. / **And in the detail underneath.**" (2nd line in brand blue)
   - Sub copy about LetTrack being a compliance product where false claims are a liability
   - **Posture summary card**: large `B+` rating in scan-green + "self-assessed security posture" mono label + paragraph mapping against ISO 27001:2022, NIST CSF 2.0, OWASP ASVS, mentioning independent certification on roadmap
3. **Audience strip** (`.aud-strip`) — 4 cards, one each for Tenants / Landlords / Agencies / Contractors, with a one-sentence promise per role
4. **Shipped today** (`.sec-block`, tag in brand blue) — 14 controls grouped into 5 themes:
   - Who can see what (controls 1, 2, 3)
   - Files & sensitive data (4, 5, 6)
   - Accountability (7, 10)
   - Encryption, secrets & login (8, 9, 12)
   - Where it lives, who handles it (13, 14, 11)
   Each control card: number, rating chip (A/B/C with colored disc), title, body, framework chips at bottom (ISO / NIST / ASVS references)
5. **Before go-live · roadmap** (`.roadmap-block`, tag in warn amber) — 10 future items, each with a dashed border + diagonal-stripe background, "COMING" badge, target rating
6. **Footnotes card** — 3 disclosure lines: ratings self-assessed, demo numbers are demo numbers, security disclosure email
7. Final CTA — "Email the security team" + back to home
8. Footer

### Hard accuracy rules (non-negotiable)

The security copy in this bundle was written carefully to obey rules in the brief. **Do not edit security copy without re-checking those rules.** Specifically:

- Only claim things in the "Shipped" group as live; roadmap items must remain future-tense and visually distinct.
- **Do NOT** claim: "UK hosted" (it's EU/Ireland), "ISO 27001 / SOC 2 certified", "two-factor authentication", "malware scanning", or "one-click GDPR deletion" — all of those belong only on the roadmap, never on the home tiles.
- Ratings are **self-assessed**; the footnote disclaimer must remain.
- LetTrack acts as **processor** (not controller) for landlord/agency uploads — keep this framing.
- Source of truth for control list / ratings / framework mappings: see the constants `SHIPPED_GROUPS` and `ROADMAP` in `security.jsx`.

## Interactions & Behavior

### Audience selector (Hero)
- Three-button segmented pill, controlled component
- `aud` state propagates via `AudienceCtx` to: hero H1 lines, hero sub copy, hero CTA label, dashboard address label and pill label
- Switching is instant (no transition needed beyond the React re-render); the `key={aud}` on H1 and sub causes them to re-mount which gives a clean swap

### Activity ribbon
- 7 hard-coded events in a constant `LIVE_EVENTS`
- Cycles every 3200ms
- Each new event animates in with `act-in` keyframe (opacity + translateY 10px → 0)
- LIVE pip pulses on a 1.4s loop
- `aria-live="polite"`; respects `prefers-reduced-motion: reduce` (stops cycling)
- On viewports under 560px, hides the "who" span (actor name) to fit

### Detection log (Mission Control)
- Pool of ~14 hard-coded log entries in `LOG_ENTRIES`
- Visible window of 5 lines; FIFO shift on each tick (1400ms)
- Latest line gets `.latest` class for slide-in animation + a blinking ink-colored caret
- Header shows a small green "LIVE" pill
- Timestamps refresh from real `Date.now()` on every push

### Streaming dashboard
- Compliance ring animates from 0 to current dash-offset (1.6s ease)
- Obligation rows flash subtly one at a time (1600ms cycle) to convey activity
- Status pills are color-coded: scan-green (OK / VERIFIED / VALID / PROTECTED), warn-amber (REVIEW / DUE), bad-red (ACTION / AWAAB_LAW)

### Atlas (floating navigator)
- Active section tracked via scroll + `getBoundingClientRect`, with a 35% viewport offset
- Needle rotation = `-(activeIdx / (n-1)) * 88deg` so it sweeps from 0° (Start) to -88° (Try free)
- Open/close toggled by orb click, `/` key, or click-outside
- Pills cascade with staggered delay (`var(--d)` = `i * 0.04s`)
- On `prefers-reduced-motion: reduce`, animations are skipped; pills just appear/disappear

### Spotlight effect
- Applied via `.spotlight` class on Platform tiles, Audience cards, Pricing cards (incl. the highlighted one)
- A global `mousemove` listener writes CSS custom properties `--mx` and `--my` on the hovered `.spotlight` element
- A `::before` pseudo-element renders a 320px radial gradient at those coordinates, fading in on `:hover`
- On the dark "highlight" Pricing card, the gradient is a warm white instead of brand blue

### Bubbles (background)
- 5 large blurred glass blobs (lavender, peach, mint, sky, warm yellow) at fixed positions
- Each parallaxes at a different speed using a `--scroll` CSS variable updated on scroll (rAF-throttled)
- Each morphs `border-radius` + `transform` on slow loops (22–30s)
- Respects `prefers-reduced-motion: reduce` — animations + parallax disabled

### Hero CTA (`Start 60 days free`)
- Per-audience label from `AUDIENCES[aud].cta`
- Currently `href="#"` placeholder — production should route to signup with audience pre-filled

## State Management

The marketing site is largely stateless. The pieces of state that exist:

- `aud` (hero) — `"landlord" | "agency" | "tenant"`, default `"landlord"`. Propagated via React Context (`AudienceCtx`). Persists for the session only.
- `lines` (detection log) — array of `{id, ts, txt, tag, cls}`, evolves on a timer.
- `flashRow` (dashboard) — integer 0–4, cycles through obligation rows.
- `scan`, `risk` (telemetry) — small cycling demo numbers.
- `open`, `active`, `isMobile` (Atlas) — bool / string / bool.
- `i` (activity ribbon) — integer index into `LIVE_EVENTS`.

In production:
- The audience selection probably wants to persist to `localStorage` and ideally to the signup link query param.
- The hard-coded demo content (`LIVE_EVENTS`, `LOG_ENTRIES`, the dashboard row data, the "14 Maple Road" address) should be **kept as demo content**, not connected to real data — they are illustrative.

## Design Tokens

Token names follow the prototype's CSS custom-property names. Reproduce these in the production design system (or map to existing tokens of the same role).

### Color

```
--bg:                  #f7f4ee   /* warm off-white page background */
--bg-2:                #ffffff   /* card surface */
--bg-3:                #efeadf   /* recessed / chip / inner surface */
--ink:                 #0e1220   /* primary text + dark surface */
--muted:               #535b70   /* secondary text */
--faint:               #8a93a6   /* tertiary text, mono labels */

--panel:               rgba(15,18,32,0.025)
--panel-2:             rgba(15,18,32,0.05)
--panel-line:          rgba(15,18,32,0.08)   /* borders */
--panel-line-bright:   rgba(15,18,32,0.14)   /* hovered borders */

--brand:               #3b5bd9   /* primary accent (blue) */
--brand-bright:        #4f6df0
--violet:              #6d5fd9
--violet-bright:       #7d6df0

--scan / "ok":         #169a5a   /* OK / VALID / PROTECTED */
--warn:                #c98a07   /* REVIEW / DUE / amber */
--bad:                 #d6463d   /* ACTION / AWAAB_LAW */

/* audience accents (segmented pill + dashboard) */
--t-agency:            { acc-a: #169a5a, acc-b: #1ba85f }
--t-landlord:          { acc-a: #3b5bd9, acc-b: #5849c7 }
--t-tenant:            { acc-a: #c66a1e, acc-b: #d18a36 }

/* bubble blob colors are hand-picked pastels; see styles.css .b1..b5 */
```

### Type

```
font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
font-feature-settings: "ss01", "cv11"

H1 (hero):         clamp(46px, 6.5vw, 84px), weight 500, tracking -0.045em, line 1.0
H1 (security):     clamp(40px, 5.4vw, 64px), weight 500, tracking -0.04em
H2 (section):      clamp(34px, 4vw, 52px), weight 500, tracking -0.035em, line 1.05
H3 (card):         24px, weight 500, tracking -0.025em, line 1.15
Section sub:       17px, weight 400, line 1.55, color muted

Body:              14–14.5px, weight 400–450, line 1.45–1.5
Tiny mono labels:  10–11px, weight 600, letter-spacing 0.08–0.12em, UPPERCASE

The prototype uses Inter for "mono" labels too (intentional uniformity) — don't switch to a real monospace family.
```

### Spacing / radii / shadows

```
Page horizontal padding: 28px (20px under 600px)
Max width:               1200px
Section vertical gap:    100–130px between major sections, 24–60px inside

Border radii:
  9–10px small (icons, mini chips)
  12–14px medium (rows, mini tiles)
  16–18px cards
  22px stage / final-CTA
  999px pills / chips

Shadows:
  Subtle card:   0 8–14px 24–32px rgba(15,18,32,.04–.08)
  Floating orb:  0 12px 28px rgba(80,60,140,.22) + 0 2px 6px rgba(15,18,32,.12) + inset 0 1px 0 rgba(255,255,255,.6)
  Highlight pricing card: 0 20px 40px rgba(15,18,32,.18)
```

### Motion timings

```
Most transitions:           150–280ms ease / ease-out
Card hover lift:            translateY(-2..-3px), 200ms
Atlas pill cascade stagger: 40ms per pill
Activity ribbon cycle:      3200ms; each event animates in over 450ms (cubic-bezier(.34,1.2,.64,1))
Detection log push:         1400ms; latest line slides in over 550ms
Compliance ring fill:       1600ms cubic-bezier(.2,.7,.2,1)
Bubble morph loops:         22–30s ease-in-out, infinite
```

## Assets

- **No raster images.** All visuals are CSS gradients + SVG icons (inline) + a single `<canvas>` element drawn by `house-canvas.jsx` (pure 2D vector math; no asset files).
- **Fonts:** Inter via Google Fonts (`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;450;500;600;700&display=swap">`). Production should self-host or use the design system's font loader.
- **Icons:** All inline SVG. They are simple stroke icons (`stroke-width: 1.8–2`). Replace with whatever icon library the production app uses (Lucide, Heroicons, custom) — match the visual weight.
- The dashboard's "14 Maple Road, Leeds · LS6 2AB" and all telemetry numbers / log entries / activity events are **demo content**. Keep them as demo content; don't hook them to real data unless the design intent changes.

## Accessibility notes

- Activity ribbon uses `aria-live="polite"` so screen readers don't get spammed with every cycle.
- Atlas pills carry `aria-label="Jump to <section>"` and a proper `tabIndex` flip (`-1` when closed, `0` when open).
- Reduced-motion is respected throughout: bubbles, activity ribbon, detection log, atlas open animation, dashboard row flash all check `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
- Section IDs (`#mission`, `#onboard`, `#ai`, `#platform`, `#audiences`, `#data`, `#pricing`) are stable anchors — preserve them, the Atlas depends on them.
- Color contrast: all body text passes WCAG AA against the off-white background; check again after porting to the production typography scale.

## Screenshots

A `screenshots/` folder contains reference captures of the design at desktop width:

**Home (`LetTrack Home.html`)**
- `01-home.png` — Hero (top of page) with eyebrow, activity ribbon, audience selector, headline
- `02-home.png` — Mission Control stage (live dashboard + 3D house + detection log)
- `03-home.png` — Onboarding (drop docs + 4 steps)
- `04-home.png` — AI core strap + stats
- `05-home.png` — Platform tiles (6 benefit cards)
- `06-home.png` — Audiences (3 cards)
- `07-home.png` — Your data / Trust tiles + security link
- `08-home.png` — Pricing (3 cards, highlighted middle)
- `09-atlas-open.png` — Atlas constellation in open state (8 pills cascading from the orb)

**Security (`LetTrack Security.html`)**
- `01-security.png` — Hero with B+ posture summary card
- `02-security.png` — Audience strip (Tenants, Landlords, Agencies, Contractors)
- `03-security.png` — Shipped: Who can see what (controls 01–03)
- `04-security.png` — Shipped: Files & sensitive data (controls 04–06)
- `05-security.png` — Shipped: Encryption / Where it lives
- `06-security.png` — Roadmap (10 items with dashed "Coming" treatment)
- `07-security.png` — Footnotes (the small print)

## Files in this bundle

| File | Purpose |
|---|---|
| `LetTrack Home.html` | Shell for the home page |
| `LetTrack Security.html` | Shell for the security page |
| `app.jsx` | Home-page React components (single file, ~1100 lines): `Atlas`, `Bubbles`, `Hero`, `MissionControl`, `Dashboard`, `DetectionLog`, `ActivityRibbon`, `Onboarding`, `Stats`, `Platform`, `Audiences`, `Trust`, `Pricing`, `Final`, `Footer`, `App` |
| `security.jsx` | Security-page React components: `SecurityPage`, `Hero`, `AudienceStrip`, `ShippedSection`, `Roadmap`, `Footnotes`, `Final`, `Nav`, `Footer`, plus `SHIPPED_GROUPS` and `ROADMAP` data |
| `house-canvas.jsx` | The `HouseCanvas` component — 2D canvas drawing of a wireframe house morphing to point-cloud, with detection chips |
| `styles.css` | All styles for both pages (~2000 lines) |
| `mobile-preview.html` | Dev helper — frames both pages inside iPhone bezels side-by-side for quick mobile review |

## Build notes

- **Routing:** The home links to `LetTrack%20Security.html` in the prototype; production routing should be `/security` (or whatever convention the app uses). Both pages link to each other and back home.
- **Babel/CDN:** The prototype loads React 18 + Babel from unpkg. In production, this all goes through the app's normal bundler. The `<script type="text/babel" src="…">` references should be replaced with normal imports.
- **CSS scoping:** All styles are wrapped under `.lt-marketing` (set on the outermost div in both `App` and `SecurityPage`). When porting, scope similarly so marketing styles don't leak into the app shell.
- **Reduced motion:** Already respected in the JSX and via a global `@media (prefers-reduced-motion: reduce)` block at the bottom of `styles.css`.
- **Outstanding placeholder links:** the nav links and footer links go to `#`. Wire them up to real routes / signup / sign-in.
- **CTA destinations:** `Start 60 days free` → signup with audience pre-filled. `Join free` → tenant/contractor signup. `Book a portfolio demo` → sales/contact form.
