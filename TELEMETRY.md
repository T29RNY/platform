# TELEMETRY.md — the product-analytics event contract

This file is the source of truth for every analytics event the platform emits.
It is to events what `RPCS.md` is to RPCs: a registry that a later change cannot
silently break.

**It is mechanically enforced.** `skills/scripts/check-telemetry-contract.sh`
fails if an event is emitted but not listed here, or listed as `live` but never
emitted. `check-hygiene.sh` CHECK 9 fails if any `posthog.capture()` is written
outside the one chokepoint. So this doc cannot drift from the code.

## How events work

- **One emitter.** Every event goes through `track(name, props, opts)` in
  `packages/core/telemetry/analytics.js`. Nothing calls `posthog.capture()`
  directly. Import it: `import { track } from "@platform/core"`.
- **Stamped automatically** on every event, do not pass them yourself:
  `event_version`, `app` (which of the 8 apps), and — once an app registers a
  context getter — `active_hat` and `hats`.
- **Suppressed automatically:** nothing is sent from localhost or an automated
  browser (Playwright / CI), so tests never pollute the dataset; nothing is sent
  for a user known to be under 18.
- **Sampling.** Pass `{ sampled: true }` for high-volume events (e.g. screen
  views). Sampled events are kept or dropped once per session (rate =
  `SAMPLE_RATE` in the module). Omit it for low-volume **anchor** events — they
  always send.

## Naming rules (additive-only)

- `snake_case`, `object_action`, domain noun not screen noun
  (`team_confirmed` ✓, `join_success_cta_tapped` ✗ — a screen gets renamed, a
  domain noun does not). Legacy names below predate this and are kept as-is
  rather than renamed, because renaming an event orphans every insight built on
  it.
- **Add properties freely; never rename or remove an event** once a consumer
  (below) depends on it. If a shape must change incompatibly, add a new event
  with a `_v2` suffix as a last resort — do not mutate the old one.
- The **Consumers** column records who reads the event (a PostHog insight, a
  planned HQ brief, an AI briefing). This is the telemetry equivalent of
  `RPCS.md` Hard Rule #14: it exists so a later change knows what it would break,
  including consumers not built yet.

## Events

| Event | Status | Since | Emitted from | Consumers |
|---|---|---|---|---|
| `join_success_cta_tapped` | live | pre-registry | `views/JoinSuccess.jsx` | Join-flow conversion (PostHog) |
| `squad_ready_cta_tapped` | live | pre-registry | `onboarding/steps/SquadReady.jsx` | Create-flow conversion (PostHog) |
| `team_player_moved` | live | pre-registry | `views/AdminView/TeamsScreen.jsx` | Smart Teams adoption analytics — trust-in-algorithm (PostHog, FEATURES.md:2694) |
| `group_assigned` | live | pre-registry | `views/AdminView/TeamsScreen.jsx` | Smart Teams adoption analytics (PostHog) |
| `team_drafted_auto` | live | pre-registry | `views/AdminView/TeamsScreen.jsx` | Smart Teams / IO-prediction accuracy (PostHog) |
| `team_regenerated` | live | pre-registry | `views/AdminView/TeamsScreen.jsx` | Smart Teams adoption analytics (PostHog) |
| `group_balancer_generate` | live | pre-registry | `views/AdminView/TeamsScreen.jsx` | Smart Teams adoption analytics (PostHog) |
| `team_confirmed` | live | pre-registry | `views/AdminView/TeamsScreen.jsx` | **Smart Teams "analytical anchor"** — is the algorithm trusted? (PostHog, FEATURES.md:2694); planned: HQ-I Phase 4 Weekly Brief (FEATURES.md:699) |
| `team_cleared` | live | pre-registry | `views/AdminView/TeamsScreen.jsx` | Smart Teams adoption analytics (PostHog) |

## Deprecated / removed

| Event | Status | Note |
|---|---|---|
| `ref_query` | removed | Was emitted by the archived Gaffer chatbot (`views/Gaffer/_archived_chatbot.jsx`), now a no-op dead file. Not re-registered. Retained here so the name is not silently reused for something else. |

## Notes

- All nine live events predate this registry and sit on the casual / Smart-Teams
  flow. Operator-, guardian- and booking-journey events (and screen views) are
  added by later phases of the telemetry epic — each one lands with a row here in
  the same PR, per the contract check.
- The `app` property cannot be backfilled onto historical events, so it is
  stamped from the first event of the epic — see the telemetry handoff.
