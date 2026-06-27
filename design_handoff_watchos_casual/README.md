# Handoff: IoO Ref — watchOS · **Casual / Sunday-league variant**

> **This is an addendum to the main watchOS handoff** (`design_handoff_watchos/`). That package is the source of truth for the design system, hardware mappings, the full screen set, state model, and SwiftUI guidance. **Read it first.** This document covers **only what the casual variant changes.** Everything not mentioned here is identical to the league screens.

## Overview
A **casual / Sunday-league / pickup** mode of the referee watch app. Same broadcast-dark teal OLED design system, same Digital-Crown player picker, same dock and logging flow — but stripped of formal-competition structure for kickabouts where there's no league, no fixtures, no crests, and ad-hoc squads.

## Fidelity
**High-fidelity (hifi)**, same as the main package. Recreate natively in SwiftUI. The px sizes in the prototype are ~2× proportional values — re-derive concrete point sizes for the real 49 mm / 45 mm displays.

---

## What's different from the league version (the ONLY differences)

1. **No competition metadata.** The kickoff gate drops the competition eyebrow (the league version shows e.g. "U18 League · Rd 12"). The casual gate shows just the app brandmark above the teams.

2. **Teams are identified by jersey colour, not club identity.**
   - Names are generic: **"Team A"** and **"Team B"** (abbreviations **"A"** / **"B"** in the score row).
   - No crests. In their place, a **jersey-shirt colour chip** (a small SVG shirt filled with the team colour) sits beside each team.
   - The two team colours are the product's **two brand colours**: **Blue `#60A0FF`** (Team A) and **Red `#FF6060`** (Team B). (Note: these differ from the league sample club colours.)
   - Subtitles describe the kit, e.g. "Blue jerseys" / "Red jerseys".

3. **Smaller, ad-hoc, possibly-uneven squads.** Team select shows player counts like **"8 players"** vs **"7 players"** (the league version says "Squad of 16"). Sizes range ~5–11 and the two sides need not be equal.

4. **Players identified by number + jersey, names optional.** In the Crown player picker, identity is the **shirt/bib number + jersey colour**. First names are shown where known (e.g. "Sam", "Jay"); where there's no name on file the player reads as **"Blue #5"** (colour + number). The focused player's secondary line is the team kit ("Blue team") rather than a formal position.

5. **No formal home/away.** Nothing is labelled home or away anywhere (the league gate shows "Home · navy" / "Away · red"; casual shows only the kit colour).

**Unchanged:** the design tokens, typography, the live-home layout (period pill, sin-bin strip, clock, score row, dock), the Action-button→Goal mapping, the **Action → Team → Player** logging order, the action grid (Goal / Yellow / Red / Sub / Sin bin / Own goal), the Crown interaction + scroll indicator + "Turn" hint, the card-confirmation moment, and the full-time confirm. The sin-bin strip still appears (a casual match can still use sin bins); its label just references the jersey ("Sin bin · Red #7").

---

## Screens in this variant

> Sample match: **Team A (blue #60A0FF) vs Team B (red #FF6060)**. Live/FT scores are casual/high-scoring (3–2, 4–3). Squads uneven (8 vs 7). Player names are first-name-only or number-only placeholders.

### 1. Kickoff gate (`CasualPreMatch`) — `screenshots/01-kickoff-gate.png`
Same layout as league gate **minus the competition eyebrow**. Brandmark alone at top; two `CasualTeamLine`s (colour bar + jersey chip + "Team A/B" + "Blue/Red jerseys") around a "VS" divider; status reads "Ready · kick off anytime"; same **Hold to start** primary button + "Press & hold 3s · or Action button" hint.

### 2. Live home (`CasualLiveHome`) — `screenshots/02-live-home.png`
Identical to league live home; only the teams change. Score row shows **A 3 – 2 B** with blue/red colour bars. Sin-bin strip label: "Sin bin · Red #7". Period pill, clock, "+2 MIN ADDED", dock (Pause / Log / Period), and the orange Action-button→Goal tab are all unchanged.

### 3. Log · What happened? (`CasualActionSheet`) — `screenshots/03-log-action.png`
**Identical** to the league action sheet (this step is team-agnostic). Header = minute + "What happened?"; 2-col grid: Goal (teal), Yellow, Red, Sub, then wide Sin bin (amber) + Own goal (orange).

### 4. Log · Which team (`CasualTeamSelect`) — `screenshots/04-log-team.png`
Header "Goal · which team?". Two large team buttons, each = colour bar + jersey chip + "Team A/B" + "**8 players · Blue**" / "**7 players · Red**" + chevron. Cancel at bottom.

### 5. Log · Which player — Crown (`CasualPlayerPick`) — `screenshots/05-log-player-crown.png`
Same Crown picker as league. Header = jersey chip + "Team A · scorer?". Focused card: shirt token (teal focus ring) + "Sam" + "Blue team". Dim neighbours: "#7 Jay" and "#5 Blue #5" (number-only fallback). Right-edge Crown scroll indicator + "Turn ⟳" hint. Primary "Choose #9 Sam ›". Shirt tokens carry a jersey-colour ring on the unfocused players.

### 6. Card confirmation (`CasualCardConfirm`) — `screenshots/06-card-confirm.png`
Same moment as league. Large yellow card glyph + "Yellow"; player = shirt token (red jersey ring) + "Marcus" + "Red team · 24'"; **Undo** + **Confirm** buttons. (Second-yellow→red, sub, sin-bin detail, etc. are unchanged from the main package and not re-shown here.)

### 7. Full time (`CasualFullTime`) — `screenshots/07-full-time.png`
Same as league FT. Whistle + "FULL TIME"; result rows with colour bar + jersey chip + "Team A/B" + big tabular score (**A 4 / B 3**, winner full opacity); red **Confirm full time** button.

---

## Data-model deltas (vs the main package's `MatchModel`)
- **Team:** `name` may be a generic label ("Team A"); add a required `jerseyColor` and optional `jerseyName` ("Blue"); make `crest` optional/absent; drop `homeAway` (make it optional/none).
- **Squad:** variable size (~5–11), the two teams independent/uneven; `player.name` **optional** — fall back to "{JerseyName} #{number}" for display; `position`/`role` optional.
- **Match:** `competition`, `round`, `fixtureId` all optional/absent in casual mode.
- A single **mode** flag (`league` | `casual`) can drive: hide competition chrome, swap crest→jersey chip, relax squad validation (allow uneven sides, allow nameless players), and hide home/away labelling.

## New component in this variant
- `Jersey({ color, s })` — small inline-SVG shirt silhouette filled with the team colour, used wherever a crest would appear (kickoff gate, team select, player pick header, full time). Recreate as a SwiftUI `Shape` or SF-Symbol-backed view tinted to the jersey colour.
- `CasualTeamLine({ team })` — colour bar + `Jersey` chip + name + "{jersey} jerseys" subtitle.

## Files
In `design_files/`:
- `watch/screens-casual.jsx` — all casual components: `TEAM_A`/`TEAM_B` sample data, `Jersey`, `CasualTeamLine`, `CasualPreMatch`, `CasualLiveHome`, `CasualTeamSelect`, `CasualFullTime`, `CasualActionSheet`, `CasualPlayerPick`, `CasualCardConfirm`.

This file depends on shared atoms/glyphs from the main package (`watch/frame.jsx`: `Watch`, `TopTime`, `Pill`, `ScoreRow`, `CrownInd`, `Shirt`, `Brandmark`, glyphs) and tokens from `watch/watch-os.css` — both included in `design_handoff_watchos/`.

In `screenshots/` — 7 hi-res reference PNGs of the casual screens, numbered to match above.
