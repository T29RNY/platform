# WATCH_DESIGN_BRIEF.md — In or Out watchOS Ref App

**Hand this file to Claude Design.** It returns `WATCH_DESIGN_HANDOFF.md` (format at the foot).
This design track runs IN PARALLEL with the backend identity build (no dependency between them).
Full engineering plan: `~/.claude/plans/once-the-ios-app-dapper-marshmallow.md`. Decisions:
DECISIONS.md s161. Tracker: FEATURES.md "## WATCHOS COMPANION APP".

---

## Product
A native **watchOS referee app** for "In or Out" — a grassroots football platform. On the wrist a
referee (or an assigned casual player) runs a **live match**: clock, score, goals, cards, subs,
periods, sin-bin, notes, added time, full-time + knockout decider. It signs the user in, auto-shows
their **next relevant game**, and (refs only) auto-tracks an Apple "Outdoor Football" workout that
**starts on kickoff and ends at full-time**. Tone: confident, sharp, broadcast-dark, glanceable in
a split second mid-match. This is a **serious live officiating tool**, NOT a cute fitness toy.

## Platform / constraints
- watchOS 10+; design for **41 / 45 / 49mm**.
- **Always-On display is mandatory** — every live screen needs a dimmed variant that keeps the
  **clock + score legible** while throttling updates (battery).
- Inputs: tap, **Digital Crown** (numeric steppers — added time, decider scores), **Double Tap**
  (Series 9+/Ultra 2 — confirm the primary action hands-free), system **haptics**.
- **Offline-capable** — show sync state (synced / pending / offline); optimistic UI with a 30s undo.
- One-handed use, whistle in the other hand. Large tap targets.

## Brand
- **Dark** theme. Pull tokens from `apps/inorout` `tokens.css`.
- Headline/numbers = Bebas Neue / condensed energy (use a watchOS-legible equivalent if Bebas
  isn't viable at size); body = SF.
- Brand lockup: **IN (green) / OR / OUT (red)**.
- Two fixed team colours: **Team A `#60A0FF`**, **Team B `#FF6060`**.
- Phosphor-thin icon language where SF Symbols don't fit the brand.

## Screens to design (each + an always-on dimmed variant where it's a live screen)
1. **Sign-in** — three states: "handed over from your phone", email-code entry, Sign in with Apple.
2. **Home / "Your next game"** — countdown, teams, venue, kickoff; primary CTA "Open". Also a
   **"you have N games" chooser** for a user with multiple same-day assignments.
3. **Pre-match** — squads/teams, kickoff gate, "Start Match" (with a note: *health tracking starts
   when you start the match here*).
4. **Live match** — clock + score header, period chip, per-team player list, action buttons:
   goal / own-goal / yellow / red / sub / sin-bin / note; offline-sync indicator; a subtle
   **"clock controller"** badge for the multi-recorder case (watch ref + web assistant).
5. **Sub picker** modal.
6. **Period controls** — HT / 2H / ET / PEN / FT dock.
7. **Full-time confirm.**
8. **Knockout decider** — AET steppers + penalty shootout tracker.
9. **Post-match summary** — final score, scorers, cards, subs.
10. **Health summary** — duration, active energy, distance, avg/max HR **+ HR-zone breakdown**
    (Outdoor Football parity). Also design a **live HR-zone element** for the live screen.
11. **Settings** — account, sign out, health-tracking explainer.
12. **Watch face complication + Smart Stack widget** — "next game in Xh", tap to open (watchOS 27
    Smart Stack surfaces it proactively near kickoff).
13. **App icon** (full watchOS size set).
14. **iPhone Live Activity + Dynamic Island** — compact, expanded, and minimal presentations:
    score / clock / period + live HR/zone, driven by realtime.

## Interaction & feedback to specify
- Digital Crown for all numeric steppers.
- **Double Tap = confirm the current primary action.**
- **Haptic patterns** for: half-time approaching, full-time, sin-bin expiry.
- Clear synced / pending / offline states; 30s undo.

## Accessibility
Min **44pt** targets; VoiceOver labels per control; Dynamic Type; colour-blind-safe score/period
cues (never colour-only).

---

## Handoff back — `WATCH_DESIGN_HANDOFF.md` must contain
1. **Screen-by-screen mockups** for every screen in the inventory, **including the always-on
   dimmed variant** of each live screen.
2. **Tokens block** — exact hex, type ramp, spacing scale, corner radii — mapped from `tokens.css`.
3. **Per-component SwiftUI specs** — SF Symbol or asset, size, state variants, tap-target px.
4. **Interaction map** — Digital Crown targets, Double Tap action, haptic pattern per event,
   transitions.
5. **Complication + Smart Stack widget** designs.
6. **App icon set + complication assets.**
7. **Live Activity layout** (compact / expanded / minimal).
8. **Accessibility notes** — VoiceOver labels, Dynamic Type behaviour, min targets.

Ideally ship **SwiftUI component stubs**, not just images.
