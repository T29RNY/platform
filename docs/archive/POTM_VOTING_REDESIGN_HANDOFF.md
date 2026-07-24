# POTM Voting Modal — Redesign Build Handoff

**Type:** Visual redesign (re-skin) — no functional/logic change.
**File to re-skin:** `apps/inorout/src/views/POTMVotingModal.jsx` (~490 lines, keep prop contract + state machine + `framer-motion` entrance springs).
**Design reference:** `design_handoff_potm_modal/` (`POTM Voting Modal.dc.html` + `support.js` + `README.md`) — an interactive prototype of the target look. Recreate it faithfully with the app's tokens/fonts/Phosphor icons. **Do not** port the prototype's vanilla state handling or its preview chrome (STATE switcher pill, phone frame, status bar, "6 – 4 / FULL TIME" backdrop) — those are prototype-only.
**Trigger:** `/dev-loop POTM_VOTING_REDESIGN_HANDOFF.md`

---

## Scope

Re-skin all five states of the POTM voting modal to match the prototype's look, depth, and motion. The prop contract (§ Props), the five-state selection logic, the two-tap commit, the "can't vote for yourself" rule, the countdown, the server-gated tally, and all close affordances are **fixed** — only the visual layer changes.

**Prop contract (DO NOT CHANGE):**
```js
POTMVotingModal({
  matchId, teamId, voterId, voterToken, voterName,
  eligiblePlayers,   // [{ id, name, nickname, team: "A"|"B" }]
  hasVoted, existingVote, votingOpen, votingClosesAt, motm,
  onClose, tally = [], totalVotes = 0, onVoted,
})
```

---

## Operator decisions (locked 2026-07-06)

These three answers override the prototype where they conflict:

1. **Gyroscope tilt — DEFERRED, do NOT build.** The prototype's device-orientation tilt (`beta`/`gamma` → `rotateX/Y`, the `enableGyro`/`onTilt`/`armGyro` block in `support.js`) is **out of scope**. Skip it entirely — no `deviceorientation` listeners, no `DeviceOrientationEvent.requestPermission()`, no `@capacitor/motion` dependency. Keep `perspective`/`transform-style` off the shipped modal (they exist only to serve the tilt). All *other* depth (static shadows, breathing glow, top sheen, extruded tiles, floating avatars) **ships**. A fast-follow may add the tilt later.

2. **Names — keep the app's nickname-first convention (option b).** The prototype shows real `name` as the headline with `"nickname"` in quotes below. **Do NOT do that.** Render the single existing convention: `player.nickname || player.name` as the one primary label. **Drop the secondary nickname line entirely.** Rationale: some players set a nickname precisely to keep their real name hidden; the redesign must not expose it. This applies to the voting tiles, the "You voted for X" lines, the locked/result names, and the tally rows.
   - **Avatar initial** = first character of the displayed label (`(player.nickname || player.name)[0]`), uppercased — not necessarily the real name's initial.

3. **Motion — always play the full celebration.** No `prefers-reduced-motion` fallback. The particle burst, seal-check pop, trophy spin-in, breathing border, and glow pulse play for everyone.

**Two implementation defaults (already agreed):**
- **Countdown ticks every 1s** (prototype cadence), replacing the current 10s interval. Clear on unmount.
- **Use CSS `@keyframes`** (extend the existing injected `potm-styles` `<style>` block) for burst / sealPop / trophyIn / glowPulse / breathe / ambient / fadeUp. Keep the existing `framer-motion` entrance springs (modal pop-in). Do not rewrite every keyframe into `framer-motion` variants.

---

## House rules (NON-NEGOTIABLE — enforced by `skills/scripts/check-hygiene.sh`, blocks commit)

- **Colours: CSS vars from `tokens.css` only.** No hardcoded hex — EXACTLY two exceptions: `#60A0FF` (Team A) and `#FF6060` (Team B). The prototype's 8-digit team tints (`#60A0FF40`, `#60A0FF66`, etc.) are allowed as they derive from those two hexes — reproduce via rgba/`color-mix()` on the team hex; introduce no new named colours.
- **Icons: `phosphor-react` components, `weight="thin"` only.** Needed: `Trophy`, `SealCheck`, `CheckCircle`, `Crown`, `Timer`, `X`. (The prototype's CDN Phosphor web-font + `ph-*` classes are preview-only — use the React components the app already imports.)
- **Fonts:** `var(--font-display)` Bebas Neue (titles, numbers, vote counts); `var(--font-body)` DM Sans (body).
- **Display copy says "POTM"** — never "MOTM"/"Man of the Match".
- **No `console.log`** — use `console.error`.
- CSS vars can't be used inside SVG `fill`/`stroke` — hex literals there (only relevant if any custom SVG is added; Phosphor handles its own).

---

## Design tokens (`apps/inorout/src/theme/tokens.css`)

**Backgrounds:** `--bg #0A0A08` · `--s1 #141412` · `--s2 #1C1C19` · `--s3 #222220`
**Text:** `--t1 #F2F0EA` · `--t2 #D0CCC2`
**Gold (hero):** `--gold #E8A020` · `--gold2 rgba(232,160,32,.15)` · `--goldb rgba(232,160,32,.4)` · `--amber #FFB020`
**Radii:** `--r 16px` · `--rs 10px` · `--r-pill 20px` · `--r-button 12px`
**Border:** `--border-subtle rgba(255,255,255,.1)`
**Team hex (only allowed literals):** A `#60A0FF`, B `#FF6060`.

---

## Layout — all states

Centred card (not full-bleed) inside the existing full-screen overlay:
- **Scrim:** `rgba(0,0,0,0.75)` + `backdrop-filter: blur(12px)` (already present). Tap-scrim-to-close stays.
- **Modal shell:** three-part flex column — **pinned header / scrolling content / pinned footer** — so the ✕ is always reachable with a 10–16 player squad. `max-width: 320px`, `max-height: calc(100dvh - 40px)` (keep `100dvh`, never `100vh`), padding around it clears the dynamic island / home area. `border-radius: var(--r)`, `1px solid var(--goldb)`, background `linear-gradient(180deg,#171613,var(--s1) 40%)`.
  - `#171613` is a new literal — **add it as a token** (e.g. `--s1-hi`) rather than hardcoding, to satisfy the hygiene gate. Same for the tile gradient stops below (`#232220`, `#191815`, `#050504` is prototype phone-frame only and not needed). Add any needed near-black stops as tokens in `tokens.css` in the same commit.
- **Top sheen:** `linear-gradient(180deg,rgba(255,255,255,0.07),transparent)`, ~90px tall, pinned to the modal's top edge, `pointer-events:none`.
- **Breathing border:** `@keyframes breathe` alternating the modal box-shadow between `0 30px 70px -20px rgba(0,0,0,.7),0 0 42px rgba(232,160,32,.16),0 0 0 1px var(--goldb)` and a brighter/larger variant, 5s loop.
- **Ambient glow** behind the modal (`@keyframes ambient`, 8s drift) is optional polish; fine to include, purely decorative.

### Header (pinned)
`padding:16px 18px 13px`, bottom hairline `0.5px solid var(--border-subtle)`.
- Eyebrow: "PLAYER OF THE MATCH" — 10px, `letter-spacing:0.14em`, uppercase, `var(--gold)`.
- Title: Bebas Neue 29px, `letter-spacing:0.04em`, `var(--t1)`. `VOTE FOR POTM` (states A/B/C) / `POTM RESULT` (state D).
- ✕ button top-right: 34px circle, `var(--s2)`, `0.5px solid var(--border-subtle)`, `<X weight="thin" size={19} />` in `var(--t2)`. Active: `scale(0.9)`.
- Countdown pill (state A only): `var(--s2)` bg, `0.5px` hairline, `border-radius: var(--r-pill)`, `<Timer weight="thin" size={15} />` gold + 12px `var(--t2)` `white-space:nowrap`. `Closes in {m}m {s}s` / `Closed`. 1s tick.

### Content (scrolls, `padding:16px`)
Each view wrapper fades in: `@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`, `.45s ease both`.

**State A — Voting** (`!hasVoted && !isResult && phase !== "locked"`)
- Helper: "Who was tonight's standout? Pick one — two taps to lock it in." (13px `var(--t2)`, second sentence `var(--t1)`).
- Per team, a section: 7px colour dot (A `#60A0FF` / B `#FF6060`) + uppercase micro-label "Team A"/"Team B" (10px `letter-spacing:0.14em` `var(--t2)`). If neither team populated, one "Players" section over all `eligiblePlayers`.
- **Player tile (extruded 3D):** flex row `gap:12px padding:12px border-radius:var(--rs)`.
  - `background: linear-gradient(180deg, <token>, <token>)` (prototype `#232220→#191815` — add as tokens); borders `border-top:0.5px rgba(255,255,255,0.09)`, `border-left/right:0.5px rgba(255,255,255,0.04)`, `border-bottom:0.5px rgba(0,0,0,0.4)`; `box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 4px 0 rgba(0,0,0,0.35), 0 9px 16px -4px rgba(0,0,0,0.5)` (the `0 4px 0` solid lip = physical thickness).
  - **Avatar:** 38px circle, `background: radial-gradient(120% 120% at 35% 25%, {teamHex}40, {teamHex}18)`, `1px solid {teamHex}66`, `box-shadow: 0 3px 7px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.15)`. Initial (Bebas Neue 19px, `{teamHex}`) = `(nickname||name)[0]` uppercased.
  - **Label:** `nickname || name` — DM Sans 15px/500 `var(--t1)`. **No second nickname line** (decision 2). Guard long labels (`min-width:0` + ellipsis) so the button never gets pushed off.
  - **Voter's own row:** `opacity:0.5`, a "You" chip (10px uppercase hairline pill), **no** vote button.
  - **Selected row:** `background: var(--gold2)`, `border:1px solid var(--goldb)`, `box-shadow:0 0 22px rgba(232,160,32,0.18)`.
- **Two-tap commit (preserve exactly):**
  - Idle → **Vote** pill: transparent bg, `var(--gold)` text/600, `1px solid var(--goldb)`, `border-radius:var(--r-button)`, `padding:8px 18px`. **Pulses** until a selection is made: `@keyframes potm-pulse{0%,100%{box-shadow:0 0 0 0 rgba(232,160,32,0)}50%{box-shadow:0 0 14px 1px var(--goldb)}}`, `2.4s ease-in-out infinite`. (Replaces the current outward-ring pulse.)
  - Tap 1 → selected row shows **Confirm →** (solid `var(--gold)`, `var(--bg)` text/700, `box-shadow:0 0 18px rgba(232,160,32,0.55)`) + a **Change** text button (12px `var(--t2)`, underlined, `text-underline-offset:3px`) that clears the selection.
  - Tap 2 (Confirm) → submits via existing `submitPOTMVote`, transitions to state B, fires `onVoted`. Button active: `scale(0.94)`. Preserve the existing `submitting` guard, `already_voted` handling, and error path.

**State B — Locked** (`phase === "locked"`)
- Centred column. Hero 100px: `<SealCheck weight="thin" size={72} color="var(--gold)" />` with `@keyframes sealPop` (scale+rotate overshoot, 0.7s `cubic-bezier(.2,.9,.3,1.2)`). Behind it a radial `var(--gold2)` glow (`@keyframes glowPulse` 3s). **Gold particle burst:** 16 dots (`var(--gold)`/`var(--amber)`, 5–8px) via `@keyframes burst{0%{transform:translate(0,0) scale(.3);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}`, per-particle `--dx/--dy` + staggered `0.015s*i` delays (build the burst element in JS, as the prototype does).
- "VOTE LOCKED IN" — Bebas Neue 32px `letter-spacing:0.05em` `var(--t1)`.
- "You voted for **{nickname||name}**" — 13px `var(--t2)`, name `var(--gold)`/600.
- Then the **live tally** (below).

**State C — Already voted** (`hasVoted && !isResult`)
- Card: `background:var(--gold2)`, `1px solid var(--goldb)`, `border-radius:var(--r)`, `padding:14px 15px`, flex row `gap:13px`. `<CheckCircle weight="thin" size={36} color="var(--gold)" />` + "YOUR VOTE IS IN" (10px uppercase gold) + "You voted for **{nickname||name}**" (15px, name gold/600).
- Then the **live tally**.

**State D — Result** (`!votingOpen && !!motm`)
- Centred column. Hero 130×120: `<Trophy weight="thin" size={92} color="var(--gold)" />` with `@keyframes trophyIn` (from `rotate(-220deg) scale(0)` overshoot to rest, ~0.95s) over radial glow + gold burst.
- Eyebrow "PLAYER OF THE MATCH" (10px uppercase `var(--t2)`).
- Winner name (via existing `resolveMotm(motm, eligiblePlayers)`, rendered as `nickname||name`): Bebas Neue 46px `var(--gold)` `letter-spacing:0.03em`.
- "wins POTM tonight!" — 14px `var(--t2)`.
- Then the **final tally**.

### Live tally leaderboard (states B, C, D)
Server-gated — `tally` arrives empty until the voter has voted; render nothing if empty. Sorted desc, winner first (RPC already sorts).
- Header: "LIVE TALLY" (10px uppercase `var(--t2)`) + "{totalVotes} VOTES" (Bebas Neue 14px `var(--gold)`).
- Per row: 28px avatar (same radial style, smaller) + name `nickname||name` (DM Sans 14px/500 `var(--t1)`); winner (`i===0`) also gets `<Crown weight="thin" size={16} color="var(--gold)" />`; the voter's own pick gets a **YOUR VOTE** chip (9px/700 gold, `var(--gold2)` bg, `var(--goldb)` border, pill). Vote count right: Bebas Neue 22px (`var(--gold)` if winner else `var(--t1)`).
- Bar: track 7px `var(--s3)` rounded; fill width `votes/max*100%`; winner fill `var(--gold)` + `0 0 12px rgba(232,160,32,0.45)` glow, else `rgba(240,240,235,0.22)`. **Animate width 0→target** on appear (`transition: width 0.9s cubic-bezier(.2,.8,.2,1)`), flipped on ~520ms after entering the state (a `barsReady` flag) so choreography reads burst → hero → bars grow.
- The voter's pick = `existingVote || selected?.id` (matches current `myPick` logic). Avatar initial + names all use `nickname||name`.

### Footer (pinned)
`padding:11px 18px 15px`, top hairline. Full-width text button 13px `var(--t2)` (hover `var(--t1)`): "skip — I'll decide later" (state A) / "Close" (all others). Preserve the current close behaviour.

---

## Data / logic notes for the builder

- **No new props, no new global state.** New local state only: `barsReady` (bool, flipped ~520ms after entering B/C/D via a `setTimeout`, cleared on state change) to drive the bar-grow. Everything else (`selected`, `phase`, `timeLeft`, `error`, `submitting`) already exists.
- **Team split** already exists (`eligiblePlayers.filter(p => p.team === "A"/"B")`), plus the single-section fallback when both are empty — keep it.
- **Winner/name resolution** already uses `resolveMotm` + `nameFor`; keep, but ensure every name render path uses `nickname || name` (decision 2).
- **Countdown:** swap the 10s interval to 1s; keep the closes-at math and unmount cleanup.
- **Add near-black gradient stops as tokens** in `tokens.css` (same commit) so no bare hex trips the hygiene gate: modal top stop, tile gradient stops. Team-hex 8-digit alpha tints are exempt.

## Verify / gates before commit
- `bash skills/scripts/check-hygiene.sh apps/inorout/src/views/POTMVotingModal.jsx` — must pass (no bare hex except the two team hexes, thin icons, no console.log, POTM copy).
- `bash skills/scripts/check-build.sh` — clean.
- **Casual-regression** (Phase 5+ cycle touching `apps/inorout/src/`) — mandatory per CLAUDE.md.
- **Real-device walk** (Hard Rule 13 — PlayerView renders this modal): open the modal in the native app and walk all reachable states (vote → locked → tally; returning-voter; result). Build/hygiene can't see "the burst didn't fire" or "a long name shoved the button off-screen."
- No RPC/schema/migration change in this cycle — pure view re-skin. (`submitPOTMVote` and the tally fetch are untouched.)

## Out of scope (do NOT build)
- Gyroscope/device-orientation tilt (deferred — decision 1).
- Real-name secondary line (decision 2).
- Reduced-motion fallback (decision 3).
- The prototype's phone frame, status bar, STATE switcher pill, and "6 – 4 / FULL TIME" backdrop (preview chrome only).
