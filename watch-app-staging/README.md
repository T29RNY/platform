# watch-app-staging — IoO Ref watchOS source (pre-approval staging)

**Status: STAGING. Not wired into any build. Not yet compiled.**

This folder holds the native Swift source for the **IoO Ref watchOS** app, authored
*ahead of* App Store approval so we have a running start the moment the base iPhone
app goes live. It is deliberately **outside** `apps/inorout/ios/` so it cannot touch
the iPhone binary that is currently mid-resubmission to App Review (build 1.0(5)).

## Why this folder exists (and why it's here, not in the Xcode project)

- A watchOS App Store app ships **bundled inside its companion iPhone app's single
  App Store record** — there is no standalone watch listing. So the watch cannot be
  *released* until the iPhone app is approved and live.
- The iPhone app (Capacitor wrap) is mid-resubmission (1.0(5)). Mutating
  `apps/inorout/ios/` now — adding a watch target, HealthKit entitlements, new
  privacy capabilities — would change the very project we're about to submit.
- **Building ≠ shipping.** Development can proceed now; only submission waits. So we
  develop the watch source *here*, in isolation, and migrate it into a watch target
  inside `apps/inorout/ios/` **after** 1.0(5) is approved.

This folder is **inert to the monorepo build**: npm workspaces are `apps/*` and
`packages/*` only, and there is no Swift toolchain in CI. Nothing imports it.

## Migration plan (post-approval)

1. iPhone app 1.0(5) **approved + live** on the App Store.
2. Operator stands up the native dev environment: a Mac with Xcode, `sudo xcodebuild
   -license accept`, and a **physical Apple Watch paired to a physical iPhone**.
3. In Xcode, add a **watchOS App target** to `apps/inorout/ios/App/`.
4. Drop these `Sources/` files into the watch target, add the SwiftUI screens
   (built to the two design handoffs), add the supabase-swift package, port the
   `apps/ref` offline/idempotency engine, add HealthKit + entitlements.
5. Compile, device-test on a real watch, then ship as a follow-up app update.

Until step 1, this is **uncompiled reference source** — expect to fix build errors
in Xcode. Treat it as a head start on the deterministic, low-churn pieces (tokens,
data model), not finished code.

## What's here now

- `Sources/Theme.swift` — design tokens (colours transcribed exactly from
  `design_handoff_watchos/design_files/watch/watch-os.css`; type roles mapped to
  **native SF** per the locked decision — Archivo/Hanken are visual reference only,
  not bundled).
- `Sources/Models.swift` — `Team`, `Player`, `MatchEvent`, `SinBin`, and the enums.
  Encodes the locked **name-first** casual identity (name primary, number optional).
- `Sources/MatchModel.swift` — the `@Observable` single-source-of-truth match state
  from the handoff's State Management section, with derived flags. Persistence,
  sync, and the supabase-swift wiring are marked TODO (post-approval).

## Locked design decisions baked in here

- **Native SF** typography (SF Compact / Rounded). Do **not** bundle Archivo/Hanken.
- **Name-first casual picker:** a casual player is identified by **name** primary,
  shirt **number optional** (`player_match.shirt_number` is nullable and usually
  null in casual). The "Blue #5" colour+number form is the *fallback* for nameless
  players, not the default. (The casual handoff leads number-first — this corrects it.)
- **Two brand team colours only** for casual: Team A `#60A0FF`, Team B `#FF6060`.
- **One model, two modes** (`MatchMode.league` / `.casual`) drives all the league-vs-
  casual differences (competition chrome, crest↔jersey, squad validation, home/away).

## Open backend dependency (not solvable here)

Casual **event-writing is Phase 5 and unbuilt.** The league arm writes to the
existing `match_events` store via the `apps/ref` RPCs; the casual arm has no write
path yet. Before casual logging beyond goals can *save*, a Phase-5 decision is
needed: does a casual match write to `match_events` (keyed by `matches.id`, which is
`text`) or to `player_match` aggregate columns, or both? The UI here can render
casual logging; it cannot persist it until that lands.

## Reference

- Design: `design_handoff_watchos/` (league, source of truth) +
  `design_handoff_watchos_casual/` (casual addendum).
- Backend already shipped: identity resolver `get_my_next_assignment` (mig 369),
  match-health storage `save_match_health_summary` / `get_my_match_health` (mig 375).
- Full epic plan: `~/.claude/plans/once-the-ios-app-dapper-marshmallow.md`.
</content>
</invoke>
