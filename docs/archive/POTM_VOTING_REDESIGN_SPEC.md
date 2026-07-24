# POTM Voting Modal — Redesign Technical Spec

**For:** Claude Design (visual redesign only — functionality is fixed and must be preserved)
**Component:** `apps/inorout/src/views/POTMVotingModal.jsx`
**App:** In or Out (native iOS-only, dark theme, five-a-side football availability app)
**Goal:** Redesign the look & feel of the "Player of the Match" voting modal to match the polish of the rest of the app. Same states, same data, same interactions — better design.

---

## 1. What this screen is

A full-screen modal overlay (dark scrim + blurred backdrop) that lets a player vote for Player of the Match after a game. It is **presentational glory** — the moment of the night for many squads — and currently looks plainer than the surfaces around it.

It renders **one of five mutually-exclusive states** depending on props. A redesign must cover **all five**:

| State | Condition | What the player sees |
|---|---|---|
| **A. Voting (idle→select→confirm)** | `!hasVoted && !isResult && phase !== "locked"` | Team A / Team B lists of eligible players, each with a Vote button. Two-tap commit: `Vote` → `Confirm →` → `Lock In ✓`. A `Change` button appears once selected. |
| **B. Vote locked (just voted)** | `phase === "locked"` | Celebratory "VOTE LOCKED IN" + trophy bounce + who they picked + the live tally leaderboard. |
| **C. Already voted (returning)** | `hasVoted && !isResult` | "You voted for X" + the live tally leaderboard. |
| **D. Result (winner declared)** | `!votingOpen && !!motm` | Trophy spin-in + winner name + "wins POTM tonight!". |
| **E. Counting / empty** | edge: voting closed, no winner yet | Handled within the above; result only shows when `motm` is set. |

The **live tally leaderboard** (a sorted bar chart of vote counts, winner-first, with a "YOUR VOTE" chip) appears in states B and C. It is server-gated — the tally arrives empty until the player has voted.

---

## 2. Props / data contract (DO NOT CHANGE)

```js
POTMVotingModal({
  matchId, teamId, voterId, voterToken, voterName,   // identity/context
  eligiblePlayers,   // [{ id, name, nickname, team: "A"|"B" }]  — the squad who played
  hasVoted,          // bool — has this voter already voted
  existingVote,      // player id they voted for (or null)
  votingOpen,        // bool — is the voting window open
  votingClosesAt,    // ISO timestamp — drives the countdown ("Closes in 4m 20s")
  motm,              // winner id (set once declared) → triggers Result state
  onClose,           // dismiss
  tally = [],        // [{ nominee_id, votes }] sorted desc — the live leaderboard
  totalVotes = 0,
  onVoted,           // fired when a vote lands
})
```

Players split into **Team A** and **Team B** sections (hardcoded colours exist for this: Team A `#60A0FF`, Team B `#FF6060` — see §4). If no team data, they render under a single "Players" section. The voter's own row renders at 50% opacity with a "You" chip and **cannot** be voted for.

---

## 3. Interaction model (must be preserved exactly)

- **Two-tap commit** per candidate: first tap `Vote` selects → button becomes `Confirm →` (+ a `Change` button appears) → second tap `Lock In ✓` submits. This deliberate friction prevents mis-taps on someone's POTM.
- Before any selection, the Vote buttons **pulse** (a gold glow keyframe, `potm-pulse`) to invite the tap.
- **Countdown** ticks every 10s from `votingClosesAt`; shows "Closes in Xm Ys" or "Closed".
- **Close affordances:** an always-visible ✕ button top-right of the header (guaranteed escape on small screens), tap-on-scrim, and a footer text button ("skip — I'll decide later" when unvoted / "Close" otherwise).
- Layout is **header (pinned) / scrolling content / footer (pinned)** so the escape button is always reachable regardless of squad size.
- Animations use `framer-motion` (already a dependency). Trophy spin-in on result, bar-width grow on tally, staggered row fade-in.

The redesign can restyle all of this but **must keep**: the two-tap commit, the "can't vote for yourself" rule, all close affordances, the pinned header/footer + scrolling middle, and the countdown.

---

## 4. Design system (hard constraints — the app's house style)

**These are non-negotiable house rules enforced by a commit hook.** The redesign must obey them or it won't build:

- **Colours: CSS variables from `tokens.css` only.** No hardcoded hex — with **exactly two exceptions**: `#60A0FF` (Team A) and `#FF6060` (Team B). Everything else must be a `var(--…)` token.
- **Icons: Phosphor React, `weight="thin"` only.** (Currently uses `<Trophy>`.)
- **Fonts:** `var(--font-display)` = **Bebas Neue** (headings, numbers, the big "VOTE FOR POTM" title). `var(--font-body)` = **DM Sans 400** (body copy).
- **Display text:** must say **POTM** (never "MOTM" / "Man of the Match") in any visible copy.
- **No `console.log`** (use `console.error`); all these are checked by `skills/scripts/check-hygiene.sh`.

### Token palette (from `apps/inorout/src/theme/tokens.css`)

**Backgrounds (near-black, warm):**
`--bg #0A0A08` · `--s1 #141412` · `--s2 #1C1C19` · `--s3 #222220` · `--b2 rgba(255,255,255,.05)`

**Text:** `--t1 #F2F0EA` (primary) · `--t2 #D0CCC2` (secondary)

**Gold (the POTM accent — this screen's hero colour):**
`--gold #E8A020` · `--gold2 rgba(232,160,32,.15)` · `--goldb rgba(232,160,32,.4)`

**Other accents available:** `--green #3DDC6A` · `--red #FF4040` · `--amber #FFB020` · `--purple #B060F0` · `--draw #14B8A6` (each with `2` tint + `b` border variants). Medals: `--silver`, `--bronze`.

**Radii:** `--r 16px` · `--rs 10px` · `--r-pill 20px` · `--r-button 12px`
**Borders:** `--border-subtle rgba(255,255,255,.1)`

> Note: CSS vars can't be used inside SVG `fill`/`stroke` — use hex literals or inline `style={{}}` there. (Relevant if the redesign adds custom SVG.)

### Current visual language (what "matches the rest of the app" means)
- Dark warm-black surfaces, **gold** as the celebratory accent, thin hairline borders (`0.5px solid rgba(255,255,255,0.06–0.10)`).
- Rounded cards (`borderRadius: 10–20`), generous padding, uppercase micro-labels (`fontSize: 10, letterSpacing: 0.14em, --t2`).
- Bebas Neue for anything big/numeric; spring-physics motion; subtle glows (`box-shadow: 0 0 24px rgba(232,160,32,0.4)` on the modal shell).
- Current modal: `maxWidth: 380`, `maxHeight: calc(100dvh - 40px)`, gold 1px border + gold glow, scrim `rgba(0,0,0,0.75)` + `backdrop-filter: blur(12px)`.

---

## 5. Platform constraints

- **Native iOS app** (Capacitor-wrapped). Design for a **phone portrait viewport**, safe-area aware, touch targets ≥ 44px. Use `100dvh` (dynamic viewport height) not `100vh`.
- Modal must handle a **long squad list** (10–16 players across two teams) — the middle scrolls, header/footer pinned.
- Styling in this file is **inline `style={{}}` objects** (no CSS modules / Tailwind). The redesign can stay inline or introduce a scoped `<style>` block (there's already a `potm-styles` injected `<style>` for the pulse keyframe) — but tokens rule still applies.

---

## 6. What to hand back

For the build handoff, the ideal deliverable from Claude Design is a **visual redesign of all five states** (A voting, B just-voted, C already-voted+tally, D result, plus the tally leaderboard component), expressed as either annotated mockups or a self-contained HTML/CSS prototype using the token palette above. Keep the prop contract (§2) and interaction model (§3) intact — the build side will re-wire the existing logic into the new look.

---

## 7. Reference — current file

Full current implementation: `apps/inorout/src/views/POTMVotingModal.jsx` (~490 lines). Read it for exact current spacing/copy. Key copy strings currently in use:
- Header: `VOTE FOR POTM` / `POTM RESULT`
- Countdown: `Closes in {Xm Ys}` / `Closed`
- Buttons: `Vote` → `Confirm →` → `Lock In ✓`, `Change`
- Locked: `VOTE LOCKED IN` / "You voted for **{name}**"
- Result: `{winner}` / `wins POTM tonight!`
- Tally: `Live tally · {n} votes`, `YOUR VOTE` chip
- Footer: `skip — I'll decide later` / `Close`
