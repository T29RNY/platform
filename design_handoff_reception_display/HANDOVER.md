# Reception Display — Claude Code Handover

> Read this end-to-end before writing a line of code. Everything you need
> to build the live screen — wiring, firing, motion, spacing, type,
> colours, structure, sizes — is in one document so you can scaffold the
> implementation in a single pass.

The design lives at `Reception Display.html` in this project. It is a
self-contained HTML file that mirrors the production target exactly
(scaling, layout, components, animations, data shape). Use it as the
visual specification AND as a working reference implementation — the
renderer functions in its `<script>` block are the contract you implement
against.

---

## 1. What this screen is

A wall-mounted TV in a football venue reception. Read-only. Identified
by a per-venue **display token** in the URL (`/display/<display_token>`).
No user session, no writes — pure subscriber + reader.

Audience: players walking in for a match, players who just finished,
casual visitors. The screen has to be glanceable from 5 metres and
hypnotic to watch from the bar.

Format: **1920 × 1080**, 16:9, letterboxed on smaller viewports via a
single `transform: scale()` on the canvas.

Always-on, persistent. Never refreshes manually. Updates come via
Supabase realtime broadcast + a 60s fallback poll.

---

## 2. File structure

```
/display/
  index.html            ← the screen itself (mirrors Reception Display.html)
  lib/
    display-state.js    ← updateDisplayState + diffing
    realtime.js         ← Supabase subscribe + reconnect
    featured.js         ← featured-match selection algorithm
    fonts.css           ← @import Google Fonts (Barlow Condensed, Inter, JetBrains Mono)
  assets/
    crests/             ← optional team crest PNGs (override the auto-shield)
```

### Dependencies

- **Supabase JS client** for realtime + RPC calls.
- **No framework needed.** The reference HTML is vanilla. If you want
  React/Vue go for it, but every renderer in the design is a pure
  `data → DOM` function — adapt one-for-one.
- **Fonts** (Google Fonts):
  - `Barlow Condensed` (500–900) — display & UI
  - `Inter` (400–800) — body
  - `JetBrains Mono` (500–700) — clock + numeric readouts

---

## 3. Canvas & scaling

```html
<div class="stage">
  <div class="canvas" id="canvas">…</div>
</div>
```

```css
.stage  { position: fixed; inset: 0; display: grid; place-items: center; background: #000; overflow: hidden; }
.canvas { width: 1920px; height: 1080px; transform-origin: center center; position: relative; }
```

```js
function fitStage() {
  const c = document.getElementById('canvas');
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  c.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', fitStage);
window.addEventListener('load',   fitStage);
```

This is non-negotiable: **build at exactly 1920×1080.** Letterboxing
happens automatically. Never use viewport units.

---

## 4. Design tokens

All tokens live as CSS custom properties on `:root`. Copy verbatim.

### Colour

```css
:root {
  /* base */
  --bg-0:  #04060B;   /* outer letterbox */
  --bg-1:  #0A0F1A;   /* canvas base */
  --bg-2:  #111827;   /* card */
  --bg-3:  #1A2235;   /* elevated card */
  --bg-4:  #2A344B;
  --line:  rgba(255,255,255,0.08);
  --line-2:rgba(255,255,255,0.16);

  /* ink */
  --ink:   #F4F6FB;
  --ink-2: #B7BFD0;
  --ink-3: #7A8499;
  --ink-4: #4D5670;

  /* venue brand — driven by venues.primary_colour / secondary_colour */
  --venue:   #0F7B5A;   /* default = Greenway green; override per venue */
  --venue-2: #15A877;

  /* broadcast accents */
  --live:   #FF1A38;
  --live-2: #FF5C70;
  --gold:   #FFC83A;
  --gold-2: #FFD96B;
  --cool:   #4DA3FF;
}
```

Team colours come straight from the data — `team.primary_colour`,
`team.secondary_colour`. Wire them through CSS custom properties on the
team element (`style="--c:#1E5BAA; --c2:#F4D03F"`) so crests / stripes
pick them up.

**Null colour fallback:** `--ink-3` (`#7A8499`) primary, `#fff` secondary.

### Type

```css
:root {
  --font-display: 'Barlow Condensed', system-ui, sans-serif;
  --font-body:    'Inter', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', monospace;
}
```

Type scale (used everywhere — match these in production):

| Use                          | Family            | Size     | Weight | Spacing |
|------------------------------|-------------------|----------|--------|---------|
| Hero score                   | Barlow Condensed  | 140 px   | 900    | -0.02em |
| Hero team name               | Barlow Condensed  | 28 px    | 900    | 0.01em  |
| Mini live tile team name     | Barlow Condensed  | 26 px    | 800    | 0.01em  |
| Section/panel titles         | Barlow Condensed  | 20 px    | 900    | 0.16em  |
| Standings team               | Barlow Condensed  | 13 px    | 700    | 0.02em  |
| Standings numbers            | system            | 12.5 px  | tabular| —       |
| Golden Boot leader name      | Barlow Condensed  | 22 px    | 900    | 0.01em  |
| Golden Boot list name        | Barlow Condensed  | 12 px    | 700    | 0.02em  |
| Coming Up team               | Barlow Condensed  | 14 px    | 700    | 0.02em  |
| Ticker player                | Barlow Condensed  | 22 px    | 700    | 0.04em  |
| Clock                        | JetBrains Mono    | 28 px    | 700    | tabular |
| Goal celebration "GOAL"      | Barlow Condensed  | 130 px   | 900    | 0.06em  |

**All numeric tables and scoreboards use `font-variant-numeric: tabular-nums`.**
Hero scores AND ticker minutes especially — without this they jitter.

### Spacing

```css
:root {
  --gap-xs: 6px;
  --gap-sm: 10px;
  --gap:    14px;
  --gap-md: 18px;
  --gap-lg: 24px;
}
```

Card padding: `14px 20px` for panel heads, `8–14px` for compact rows.
The lower-row panel grid uses **18px** gaps between columns.

### Radius

```css
--radius-sm:  4px;   /* pills */
--radius:     8px;   /* small chips */
--radius-md:  12px;  /* cards inside panels */
--radius-lg:  18px;  /* panels */
--radius-xl:  22px;  /* hero */
--radius-pill: 999px;
```

### Shadow

```css
--shadow-card: 0 30px 60px -20px rgba(0,0,0,0.7),
               0 0 0 1px rgba(255,255,255,0.06);
--shadow-hero: 0 40px 80px -20px rgba(0,0,0,0.8),
               0 0 0 1px rgba(255,255,255,0.08);
```

---

## 5. Layout — 1080p anatomy

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER  80px       venue brand · IoO banner · status · clock    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LIVE ROW   470px                                               │
│  ┌──────────────────────────────┐  ┌────────────────────────┐   │
│  │                              │  │                        │   │
│  │   HERO (featured match)      │  │   MINI LIVE TILE       │   │
│  │   1180 px wide               │  │   1/2 of side stack    │   │
│  │                              │  │                        │   │
│  │                              │  ├────────────────────────┤   │
│  │                              │  │   MINI LIVE TILE       │   │
│  │                              │  │   1/2 of side stack    │   │
│  └──────────────────────────────┘  └────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  LOWER ROW    1fr (≈396px)                                      │
│  ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────────────────┐        │
│  │ LIVE     │ │ GOLDEN │ │ COMING │ │  TALL PROMO      │        │
│  │ TABLE    │ │ BOOT   │ │ UP     │ │  (portrait ad)   │        │
│  │ rotates  │ │ top 10 │ │ TONIGHT│ │  rotates venue   │        │
│  │ between  │ │        │ │ league │ │  ↔ IoO app       │        │
│  │ leagues  │ │        │ │ + casual│ │                  │        │
│  └──────────┘ └────────┘ └────────┘ └──────────────────┘        │
├─────────────────────────────────────────────────────────────────┤
│ TICKER  80px      [GOALS TONIGHT chevron] scrolling goals       │
└─────────────────────────────────────────────────────────────────┘
```

```css
.header { position: absolute; inset: 0 0 auto 0; height: 80px; }
.main   { position: absolute; top: 80px; bottom: 80px; left: 0; right: 0;
          display: grid; grid-template-rows: 470px 1fr; gap: 18px;
          padding: 18px 24px; }
.ticker { position: absolute; left: 0; right: 0; bottom: 0; height: 80px; }

.live-row { display: grid; grid-template-columns: 1180px 1fr; gap: 18px; }
.side-stack { display: grid; grid-template-rows: 1fr 1fr; gap: 18px; }

.lower { display: grid;
         grid-template-columns: 1.05fr 0.62fr 0.62fr 0.5fr;
         gap: 18px; }
```

---

## 6. Component spec

Each section here is: visual purpose → dimensions → data binding →
behaviour. Cross-reference the working DOM in `Reception Display.html`.

### 6.1 Header (`.header`, 80 px tall)

3 columns: `auto 1fr auto`.

- **Left — venue brand.** Crest (48×48 venue shield clip-path, primary
  gradient, white TLA), name (`venues.name`, Barlow Condensed 24, all
  caps), sub line (`venues.short_name + 'Matchday Wall · Reception'`).
- **Centre — IoO promo banner.** A pill that promotes the In or Out app.
  Logo (gold ball with "i/o"), wordmark "IN · OR · OUT", tagline ("League
  admin, sorted. Stats automatic."), CTA pill ("Get the app →"). Static
  in v1; could rotate the tagline if marketing wants A/B.
- **Right — status cluster.** Live count pill (red, pulsing dot, count
  from `live_fixtures.length`), competition pill (current rotated league
  short code), clock (JetBrains Mono, `server_time` + local drift, see
  §11), date line (e.g. `MON · 08 JUN`).

### 6.2 Hero match (`.hero`, 1180 × 470)

The featured live match. Driven by the **featured selection algorithm**
in §8.

Internal rows: `44px bar + 1fr body + 96px footer`.

**Bar (44 px):**
- Comp badge (gold pill, e.g. `GPL D1`)
- Title: `R12 · Pitch 1 (North) · Ref Petersen` — round + pitch + ref
- Story tag (right): one of `★ Top-of-table`, `⚡ Goal just in`,
  `⚖ Nail-biter`, `🔥 Action` — chosen by the featured rule that won
- Live indicator: pulsing dot + `LIVE` + minute (`59'`, computed
  client-side from `actual_kickoff_at + server_time`)

**Body (1fr):**
- 3-column grid (`1fr auto 1fr`)
- Left + right: shield-clipped CSS crest (`150×168`), primary colour
  fill, diagonal secondary stripe, white TLA at 48 px Barlow 900. Soft
  team-color radial pulse behind the crest (4s breathe). Below the
  crest: full team name (28 px, ellipsis-truncated to width 320),
  rank/story line (e.g. `1st · Unbeaten in 8`).
- Centre: score (140 px h, 64 px dash, 140 px a, white, `tabular-nums`,
  drop shadow). Below the score: "last action" pill (`⚽ 58' · Ahmed (NSA)`).

**Footer (96 px):**
- Momentum bar: `Last 10'` label + 10 px horizontal bar split
  `home%` vs `away%` (colored gradients) + numeric readout. Source:
  count of `match_events` per team in last 10 minutes / total.
- Event strip: last 4 `match_events` rendered as small horizontal cards.
  Goal cards are gold-tinted with the latest goal showing a soft pulse
  ring (`.event-card.goal.latest`).

**Crossfade on featured swap.** When the featured match changes (re-eval
every 60s), call `crossfadeHero(newFixture)` — drops opacity to 0.3
over 250ms, you swap content, fade back.

### 6.3 Side live tiles (`.mini`, ~226 × ~226 each)

Two tiles stacked. Each is a compressed scoreboard for one of the other
in-progress matches.

Rows: `40 head + 1fr body + 50 feed`.

- Head: GPL D1 chip, pitch label, live indicator (`LIVE 59'`).
- Body: 2 team rows. Each row is `54 crest + 1fr name + auto score`.
  Crest = same shield clip-path at 46×50, TLA 15 px. Name 26 px Barlow,
  truncated. Score 50 px (leading team scored in gold).
- Feed: `Recent | 54' [yc] Brookman | 46' [sub] Fraser on | ...` — 3
  recent events as inline chips. Colored 12×12 ico squares (goal=gold,
  yc=yellow, rc=red, sub=blue).

### 6.4 Live Table (`.lower` col 1)

Rotating standings across all active competitions for this venue.

Panel head is two rows:

```
Row 1:  [● Live Table]                          [10s countdown]
Row 2:  [GPL Div 1 active][GPL Div 2][Open Cup]   [sub label]
```

- League tabs are pills. Active tab has a gold border + a 2 px gold
  progress bar at the bottom that fills as the rotation timer counts
  down. Rotation interval: **`display_config.interval_secs`** (default
  10 s; clamp 10–60 per spec).
- Rotation mode: `display_config.mode`
  - `cycle` — straight round-robin
  - `smart` — skip leagues with no live fixtures unless there are none
    elsewhere
  - `fixed` — pin a single league
- Sub label: short text per league (`Live`, `Final`, `Group A`).

Body is a `table` with `table-layout: fixed`:

| Col   | Width | Content                  |
|-------|-------|--------------------------|
| rank  | 38 px | bold rank number         |
| team  | auto  | 5px colour swatch + team name (Barlow 13, ellipsis) + delta arrow |
| P W D L | 32px each | played / win / draw / loss |
| GD    | 42 px | goal diff, `+` prefix when positive |
| PTS   | 46 px | bold points                |
| Form  | 96 px | last-5 results as 12×12 colored squares (W=venue green, D=slate, L=dark red) |

Leader row gets `.lead` (subtle gold tint, gold rank colour).
Rows with a team that's live get `.live-flag` (subtle red tint + left
border red bar).

Source per panel render:
- For league type: `competition.standings_live` (always — even when
  the panel is showing this comp the screen prefers live; if all matches
  in the comp are FT, it equals `standings_confirmed`).
- For cup type with group stage: `cup.groups[*].standings` (use the
  same row structure but show a qualifying mark on the "team" col).

**Animations:**
- Form letters fade in left-to-right on render (`@keyframes formIn`)
- `flashRank(teamId)` on a row whose rank changed (1.6 s amber tint
  fade-out)

### 6.5 Golden Boot (`.lower` col 2)

Top 10 scorers for the **currently displayed league** in the table panel
(rotates in sync). Falls back to the venue's "headline" league if the
active panel is a private competition.

Two rows: `110 leader + 1fr list`.

**Leader card (110 px):**
- 70×88 photo placeholder (gradient + repeating diagonal stripe + shirt
  number badge). When a real photo exists, swap to a cover-fit image.
- Name (Barlow 22, ellipsis)
- Team line: colour swatch + team name + position (`Northside Athletic · ST`)
- Mini stats row: `Apps`, `MoM` (Man of the Match), `G/90`
- Right-aligned: big gold goals tally + `Goals` caption

**List (1fr, repeat(9, 1fr)):**
- Each row: rank, 4 px colour bar, name + team subtitle, gold goal count
- Ties show same rank number (e.g. two rank-4s)

Source: `competition.top_scorers` (sorted by goals desc).

### 6.6 Coming Up Tonight (`.lower` col 3)

Tonight's fixtures (league) **and** casual bookings on the venue's pitches.
League fixtures always sort first. Each row 2-col grid: `50 KO + 1fr block`.

KO column: `t` (HH:MM mono), `inm` ("IN 43M" / "IN 1H 43M" / "FAR").
Imminent fixtures (next 60 min) tinted gold with gold left border.
Casual rows get a blue left border instead.

Right column shows team(s) and a meta row:

```
[●] Wandle Phoenix
[●] Cypress Park
[ GPL D1 ] [ P1 ] Ref Okafor
```

- Pitch chip is blue. If `pitch_name` is null, show `TBC` neutral.
- Ref shows in red (`Needs ref`) if `official_id` is null.
- Casual single-name rows omit the away team line (`away = '—'` flag).

Sources:
- League: `upcoming_fixtures` (filter today only, by `kickoff_time`)
- Casual: occupancy rows where `source_kind = 'booking'` and within
  the current hour window. Map to:
  - `home = team_name` (the booker)
  - `away = '—'` (single-team booking)
  - `comp = 'Casual'`
  - `kind = 'casual'`

### 6.7 Tall Promo (`.lower` col 4)

The portrait sponsor/ad tile. Full lower-row height. Rotates every 8
seconds between two creative types:

**Venue creative** (`kind: 'venue'`):
- Top: image slot. In production, render `<img src="{sponsor_image_url}"
  style="object-fit: cover; width:100%; height:100%; border-radius:12px;">`.
  Before the operator uploads one, show the dashed placeholder with a
  venue glyph + label `Sponsor image (uploaded by venue)`.
- Bottom: tag (`sponsor_label`), title (Barlow 30), sub line
  (`custom_message` or body copy), URL chip + arrow CTA.

**IoO creative** (`kind: 'ioo'`):
- Top: a vertical phone mockup with 5 fake match rows showing live
  scores (built with the same `.phone__row` styles — copy verbatim from
  the design file).
- Background gets a subtle blue+gold radial glow.
- CTA arrow turns gold.
- Title swaps to short marketing copy.

Rotation ratio: configurable per venue via
`display_config.sponsor_ratio` (default 70/30 venue:ioo). When a venue
has not uploaded any creative, ratio goes 100% IoO (don't show empty
placeholder in prod).

Crossfade: 250 ms opacity fade-out, swap content, fade-in.

### 6.8 Goals ticker (`.ticker`, 80 px tall)

Bottom bar. Three regions:

```
[ GOLDEN CHEVRON: ⚽ GOALS TONIGHT ] [ scrolling track ] [ sync status ]
```

- Left chevron (clip-path polygon, gold), label always `Goals tonight`
- Track: horizontal scroll, 90 s loop. Items: `⚽ 58' [●] Tariq Ahmed · Northside`.
  Source: `goals_ticker` (≤ 30 most recent).
- Right: small live-sync indicator + `Ns ago` counter (real seconds
  since last successful state pull).

Doubled list (`items + items`) for seamless wraparound. `@keyframes
scroll { 0% → 100% { translateX(-50%) } }`.

---

## 7. Data layer — RPC contract

### Single RPC for state

```sql
get_display_state(p_display_token text) RETURNS jsonb
SECURITY DEFINER, granted to anon
```

Returns one jsonb payload that drives the whole screen. Field names are
the contract — keep them stable.

```jsonc
{
  "venue": {
    "id": "…", "name": "Greenway Sports Park",
    "logo_url": null, "primary_colour": "#0F7B5A", "secondary_colour": "#FFC83A",
    "live_channel_key": "gw-live-7t3xz",
    "display_config": {
      "zones": ["live_scores","upcoming","recent","standings","top_scorers","goals_ticker","custom_message"],
      "mode": "smart",          // 'smart' | 'cycle' | 'fixed'
      "interval_secs": 10,      // 10..60
      "custom_message": "Welcome to Greenway. Boots only on the 3G.",
      "sponsor_image_url": "https://…",
      "sponsor_label":     "Sponsor · Greenway Tap",
      "sponsor_title":     "Post-match pint? £4 til 10pm.",
      "sponsor_body":      "Show your matchday wristband. Side entrance.",
      "sponsor_url":       "greenwaysp.co.uk/tap",
      "sponsor_ratio":     0.7, // 0..1 — share of venue vs IoO
      "featured_fixture_id": null, // operator pin overrides featured selection
      "featured_pin_expires_at": null
    }
  },
  "server_time": "2026-06-08T19:47:12Z",

  "competitions": [{
    "competition_id": "…",
    "name": "GPL Division 1",
    "type": "league",            // 'league' | 'cup'
    "format": "round_robin",     // 'round_robin' | 'single_elimination' | 'group_stage'
    "league_id": "…", "league_name": "Greenway Premier League",
    "standings_visibility": "public",
    "season": { "name": "Spring 2026", "start_date": "2026-03-04", "end_date": "2026-06-24" },
    "standings_confirmed": [/* Standing[] */],
    "standings_live":      [/* Standing[] */],
    "top_scorers": [{
      "player_id": "…", "name": "Tariq Ahmed",
      "team_id": "…", "team_name": "Northside Athletic",
      "primary_colour": "#1E5BAA", "goals": 14
    }]
  }],

  "live_fixtures": [{
    "fixture_id": "…", "competition_id": "…", "competition_name": "GPL Division 1",
    "competition_type": "league",
    "home_team_id": "…", "home_team_name": "Northside Athletic",
    "home_primary_colour": "#1E5BAA", "home_secondary_colour": "#F4D03F",
    "away_team_id": "…", "away_team_name": "Eastpark United",
    "away_primary_colour": "#C0392B", "away_secondary_colour": "#1B1B1F",
    "home_score": 2, "away_score": 1,
    "pitch_name": "Pitch 1 (North)",
    "actual_kickoff_at": "2026-06-08T19:30:00Z",
    "recent_events": [{
      "type": "goal",            // 'goal' | 'own_goal' | 'yellow_card' | 'red_card' | 'substitution' | 'period_change'
      "minute": 58, "period": "second",
      "player_name": "Tariq Ahmed", "team_id": "…"
    }]
  }],

  "upcoming_fixtures": [{
    "fixture_id": "…", "competition_name": "GPL Division 1",
    "kickoff_time": "20:30", "pitch_name": "Pitch 1 (North)",
    "home_team_name": "Wandle Phoenix", "home_primary_colour": "#B23A48",
    "away_team_name": "Cypress Park",   "away_primary_colour": "#0E4D3F"
  }],
  "recent_results": [/* same shape + score */],
  "goals_ticker":   [{ "player_name": "Tariq Ahmed", "team_name": "Northside",
                       "primary_colour": "#1E5BAA", "minute": 58, "competition_name": "GPL D1" }],

  "cup": {  // only for type='cup'
    "champion": null,
    "groups":   [/* { group_label, standings: [{ team_id, team_name, qualifying, played, w, d, l, gd, pts }] } */],
    "rounds":   [/* { round_number, round_name, ties: [{ home_team_name, away_team_name, home_score, away_score, winner_team_id }] } */]
  }
}
```

### PIN gate

```sql
check_display_pin(p_display_token text, p_pin text) RETURNS jsonb
  -- { pin_required: bool, ok: bool }
```

Never returns the PIN. 3-strike, 30-min lockout is client-side
(localStorage). After 3 wrong attempts, freeze the input for 30 minutes
and show a `Locked — try again at HH:MM` message.

### Operator writes (NOT called from this screen)

```sql
venue_update_display_config(p_venue_token, p_config, p_display_pin)
```

Called by the **Venue Operator App** only. Validated: `mode` enum,
`interval_secs` 10..60, known `zones`. After update, broadcasts a
venue-change event so live screens refresh.

This screen calls **zero write RPCs.** Ever.

### Realtime channel

```js
supabase.channel(`venue_live:${payload.venue.live_channel_key}`)
  .on('broadcast', { event: '*' }, () => refetchState())
  .subscribe();
```

Any broadcast on the channel = re-pull `get_display_state`. Don't try to
diff incoming broadcast payloads; the broadcast is intentionally a
"ping", the RPC is the source of truth.

Wire a **60-second fallback poll** that calls `get_display_state` regardless,
in case a push is missed. The screen's "synced Ns ago" indicator shows
the seconds since the last successful state response.

### Auth + edge cases

- No token / empty token → show "Display not set up" + venue logo placeholder.
- `invalid_display_token` error → "This display has been deactivated. Contact venue staff."
- PIN required + not entered → big PIN keypad over the canvas.
- Realtime drops → show a small `Live updates paused — reconnecting` toast bottom-left, keep polling.
- All arrays empty → fall back to venue logo + `custom_message` centered.

---

## 8. Featured match selection — verbatim

Priority order. **First match wins.** Re-evaluate every 60 seconds OR on
each `get_display_state` response, whichever comes first.

```
1.  PINNED
    if display_config.featured_fixture_id is set:
       if that fixture is in live_fixtures: pick it; story_tag = display_config.featured_pin_story_tag or "★ Featured"
       if pin has expired or fixture is FT: continue to 2.

2.  ★ TOP-OF-TABLE
    candidates = live_fixtures where BOTH teams are in top 3 of
                 their competition's standings_live (ranked by pts, gd, gf)
    if non-empty: pick the one with the latest actual_kickoff_at; story_tag = "★ Top-of-table"

3.  ⚡ GOAL JUST IN
    candidates = live_fixtures with a 'goal' or 'own_goal' event in
                 recent_events whose minute >= (current_match_minute - 5)
    sticky latch: once chosen, stays featured for >= 60 seconds even if
                  a more recent goal happens elsewhere (avoids flapping)
    if non-empty: pick the most recent goal; story_tag = "⚡ Goal just in"

4.  ⚖ NAIL-BITER
    candidates = live_fixtures where |home_score - away_score| == 1
                 AND current_match_minute >= 70
    if non-empty: pick highest combined score; story_tag = "⚖ Nail-biter"

5.  🔥 ACTION
    candidates = all live_fixtures; rank by count of recent_events
                 in the last 10 minutes
    if max > 2: pick top; story_tag = "🔥 Action"

6.  RECENCY
    pick the live_fixture with the most recent actual_kickoff_at;
    no story_tag.

7.  NO LIVE
    if live_fixtures empty:
       if upcoming_fixtures non-empty within next 60 min: show "Up Next" hero variant
       else: show venue logo + custom_message as full-screen hero
```

The story tag the rule sets goes in the top-right of the hero bar as a
small gold-tinted pill (see `.hero__story` in the design CSS).

Cross-fade when the featured fixture changes (`crossfadeHero(newFixture)`).

---

## 9. Integration API — what to call

Single entry point: **`updateDisplayState(payload)`**. Everything else
is internal. Build it like this:

```js
let __lastPayload = null;

async function refetchState() {
  const { data, error } = await supabase.rpc('get_display_state', { p_display_token: TOKEN });
  if (error) { showError(error); return; }
  updateDisplayState(data);
}

function updateDisplayState(payload) {
  const prev = __lastPayload;
  __lastPayload = payload;

  // 1. Rebuild data arrays from payload
  LEAGUES = buildLeagues(payload.competitions);
  SCORERS_TOP10 = buildScorers(payload.competitions, activeLeagueIdx);
  UPCOMING = buildUpcoming(payload.upcoming_fixtures, payload.bookings);
  TICKER = payload.goals_ticker;

  // 2. Re-render panels
  renderLeagueTabs(activeLeagueIdx);
  renderTable(activeLeagueIdx);
  renderGB();
  renderUpcoming();
  renderTicker();

  // 3. Featured match re-evaluation
  const featured = selectFeatured(payload);
  if (!prev || featured.fixture_id !== currentFeatured?.fixture_id) {
    crossfadeHero(featured);
    currentFeatured = featured;
  } else {
    renderHero(featured, /* in place */ true);
  }

  // 4. Diff for animations
  if (prev) diffAndAnimate(prev, payload);

  // 5. Side mini tiles for the non-featured live fixtures
  renderSideTiles(payload.live_fixtures.filter(f => f.fixture_id !== featured.fixture_id).slice(0, 2));
}

function diffAndAnimate(prev, next) {
  const prevEvents = collectAllEvents(prev);   // map<eventId, event>
  const nextEvents = collectAllEvents(next);
  for (const [id, ev] of nextEvents) {
    if (!prevEvents.has(id) && ev.type === 'goal') {
      triggerGoalCelebration({ plr: ev.player_name, team: ev.team_name,
                               c: ev.team_primary_colour, min: ev.minute + "'" });
    }
  }

  for (const f of next.live_fixtures) {
    const pf = prev.live_fixtures.find(p => p.fixture_id === f.fixture_id);
    if (!pf) continue;
    if (pf.home_score !== f.home_score) scorePunch(`score-${f.fixture_id}-h`);
    if (pf.away_score !== f.away_score) scorePunch(`score-${f.fixture_id}-a`);
  }

  for (const c of next.competitions) {
    const pc = prev.competitions.find(p => p.competition_id === c.competition_id);
    if (!pc) continue;
    for (const row of c.standings_live) {
      const prevRow = pc.standings_live.find(r => r.team_id === row.team_id);
      if (prevRow && prevRow.rank !== row.rank) flashRank(row.team_id);
    }
  }
}
```

Throttle the goal celebration: at most one celebration every 5 seconds.
Queue extras and play them sequentially.

---

## 10. Animation catalog

| Name                 | What triggers it                              | Duration | CSS / JS                  |
|----------------------|------------------------------------------------|----------|----------------------------|
| Pulse (red dot)      | Always on, all live indicators                 | 1.4 s loop | `@keyframes pulse`        |
| Crest ambient pulse  | Always on, hero crests                          | 4 s loop | `@keyframes crestPulse`   |
| Form letter cascade  | On standings render                            | 100 ms × 5 | `@keyframes formIn`        |
| League tab progress  | Rotation timer                                 | `interval_secs` | inline width transition |
| Promo crossfade      | Promo rotator tick (8 s)                       | 250 ms in/out | `.tall-promo.fade-*`     |
| Ticker scroll        | Always on                                       | 90 s loop | `@keyframes scroll`       |
| Score punch          | Score changes (`scorePunch`)                   | 700 ms   | `@keyframes scorePunch`   |
| Rank flash           | Rank changes (`flashRank`)                     | 1.6 s    | `@keyframes rankFlash`    |
| Hero crossfade       | Featured match changes (`crossfadeHero`)       | 250 ms   | `.hero.hero-fading`       |
| **Goal celebration** | New goal event (`triggerGoalCelebration`)      | 3.5 s    | `.goal-celebration.active`|

### Goal celebration overlay (most important)

Full-screen take-over of the hero. Z-index 20, `position: absolute;
inset: 0` inside `.hero`.

Layers:
- Backdrop radial gradient (dark vignette over hero contents)
- Team-color linear gradient (h primary → a primary, opacity 0.35)
- Diagonal streak overlay, animates from `translate(-30%,-30%)` to
  `translate(10%,10%) rotate(8deg)` over 1.4 s
- Centered card: blurred dark glass, big gold **GOAL** word (130 px),
  player name (40 px), team strip + minute meta

Open: `el.classList.add('active')`. Hold: `setTimeout` 3500 ms.
Close: `el.classList.remove('active')`. No transitions on the root —
just opacity toggle (the inner streak still animates because its
animation is scoped to `.active .goal-celebration__streak`).

---

## 11. Match minute computation

The payload does **not** carry the live minute. Compute client-side so a
drifting TV clock doesn't matter:

```js
function getMatchMinute(fixture, serverTime) {
  const kickoff = new Date(fixture.actual_kickoff_at).getTime();
  const now = new Date(serverTime).getTime()
            + (Date.now() - __lastStateAt);    // local drift since last payload
  let mins = Math.floor((now - kickoff) / 60000);
  if (mins < 0) mins = 0;
  return mins + "'";
}
```

`server_time` from the payload anchors the client clock. The on-screen
clock in the header also drives off this anchor — never `Date.now()` raw.

Half-time: when `recent_events` contains a `period_change` event with
`period: 'half_time'`, hold the minute at `HT` instead of incrementing.

---

## 12. Per-venue config

Everything venue-specific lives in `venues.display_config` and is
edited from the Venue Operator App. The display NEVER edits it.

| Field                       | Purpose                                       | Default               |
|-----------------------------|-----------------------------------------------|-----------------------|
| `zones[]`                   | Which panels are visible                      | All on                |
| `mode`                      | `smart` / `cycle` / `fixed` league rotation   | `smart`               |
| `interval_secs`             | Rotation interval (10–60)                     | 10                    |
| `custom_message`            | Fallback message when nothing live            | venue welcome string  |
| `sponsor_image_url`         | Tall promo creative                           | null (placeholder)    |
| `sponsor_label/title/body/url` | Tall promo copy                            | null                  |
| `sponsor_ratio`             | Venue vs IoO share (0..1)                     | 0.7                   |
| `featured_fixture_id`       | Operator-pinned featured match                | null                  |
| `featured_pin_expires_at`   | Optional auto-clear timestamp                 | null                  |
| `display_pin`               | 4–6 digit unlock PIN, hashed                  | null (no gate)        |

When the operator changes any of these, the existing realtime broadcast
fires, the screen re-pulls state and re-renders. No manual refresh.

---

## 13. Production checklist

- [ ] Self-contained HTML at `/display/index.html` mounted on the venue's domain.
- [ ] Token-only auth via URL path. No cookies, no Supabase auth.
- [ ] CSP allows Supabase + Google Fonts only.
- [ ] Service worker for offline state: when network drops, show last
      successful payload with a `Live updates paused` toast. Don't blank.
- [ ] `cache-control: no-store` on the HTML; long cache on fonts + JS.
- [ ] Smart TV friendly:
  - No keyboard / mouse expected
  - Don't rely on hover
  - Test on a real cheap Android stick (Chromium 80+) for animation perf
  - Drop the canvas drift animation if FPS dips
- [ ] Wake-lock API or a "page never idle" heartbeat — some TVs sleep
      the page after inactivity.
- [ ] LocalStorage:
  - PIN strike count + lockout-until timestamp
  - Last successful payload (for cold-load instant render)
- [ ] Error boundary around `updateDisplayState` — never crash the whole
      screen because one panel's payload is malformed. Log + render
      empty state for that panel only.
- [ ] Accessibility: this is a wall TV, not interactive — `aria-hidden`
      on motion-heavy content is fine, but keep `prefers-reduced-motion`
      respected for the goal celebration and ticker (slow them; don't
      kill them — venues will complain).

---

## 14. Things I'd ask you to not change

These aren't preferences, they're product calls baked into the spec:

- **No interactivity on this screen.** No taps, swipes, settings — the
  operator app owns all config.
- **Read-only.** No writes. Ever.
- **1920 × 1080 only.** Don't make it responsive in the typical sense.
  Scale + letterbox.
- **No team-tinted score numbers** in the hero — they collide with the
  crests behind. Score is white, the crest carries the team identity.
- **No emoji except `⚽` and the ticker chevron ball.** The story tags
  use ★ ⚡ ⚖ 🔥 as design intent, not lazy emoji.
- **Tabular nums everywhere a number could change** — scores, minutes,
  PTS, GD, GF, GA, goals tally.
- **Font: Barlow Condensed.** Do not substitute. The whole broadcast
  vocabulary depends on it.

---

## 15. Quick reference — file → field map

When you wire `updateDisplayState`, here's where to read what:

| Renderer            | Reads                                         |
|---------------------|-----------------------------------------------|
| `renderHero(f)`     | one `live_fixtures[i]` (chosen by featured rule) + `competitions[i].standings_live` for rank line |
| `renderSideTiles()` | other `live_fixtures` (max 2) + their `recent_events[]` |
| `renderTable(idx)`  | `LEAGUES[idx].standings` = a `competitions[*].standings_live` |
| `renderGB()`        | `competitions[matching].top_scorers`          |
| `renderUpcoming()`  | `upcoming_fixtures` + casual bookings         |
| `renderTicker()`    | `goals_ticker`                                |
| `renderPromo(i)`    | `venues.display_config.sponsor_*` (kind venue) or static IoO copy |
| `tickClock()`       | `server_time` + local drift                   |

---

That's everything. Open `Reception Display.html` next to your editor as
the working reference; it has the exact CSS, animation keyframes,
renderer functions, and DOM structure you'll need. The screen design and
the code are deliberately co-located.

Ping me if anything in here is ambiguous — better to fix the spec than
ship a wrong implementation.
