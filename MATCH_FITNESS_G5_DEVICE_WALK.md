# G5 — Match Fitness Real-Device Walk

**The final human gate before flipping `VITE_HEALTH_KIT_ENABLED`.** HealthKit behaviour
cannot be tested any other way — a simulator has no health data, and read-permission state is
invisible to code. Walk every case once on a real iPhone + Apple Watch and record the result.

Report back per row: **PASS / FAIL / N/A** + a note. Anything FAIL → stop, don't flip the flag.

---

## Preconditions (check before you start)

- [ ] **You are signed in on the operator account that's on the test-bed allowlist.**
  While the global flag is off, the allowlist (your Footy Tuesdays admin auth-ID, hardcoded in
  `native-health.js`) is the **only** thing that makes the "attach workout" button appear.
  → **Do not remove the allowlist until after the flag flips** (it's this test's enabler).
- [ ] Running the **live App Store build 1.1.0(10)** (HealthKit-approved) on a real iPhone.
- [ ] iPhone is paired with an Apple Watch that can record workouts.
- [ ] You have (or can create) at least one **casual** In-or-Out game to attach to.

---

## A. Permission handling

| # | Step | Expected | Result |
|---|---|---|---|
| A1 | First attach → tap through the 18+ age gate → trigger the Health permission prompt | Apple's Health permission sheet appears (no infinite "Requesting Health access…" spinner) | ⬜ |
| A2 | **Grant** access | Flow proceeds to the workout list/confirm sheet | ⬜ |
| A3 | On a fresh install / reset, **deny** access instead | Graceful one-line "Health access off" style message, **no spinner-forever, no crash** | ⬜ |
| A4 | Deny, then later grant via Settings › Privacy & Security › Health | Attach works after granting | ⬜ |

## B. Outdoor game — the full happy path

| # | Step | Expected | Result |
|---|---|---|---|
| B1 | Record a real **Outdoor** Apple *Soccer* workout on the watch during/around a casual game | Workout saves to Apple Health | ⬜ |
| B2 | Open the app on the result card for that game → attach | The matching workout auto-surfaces in the confirm sheet (time-window match) | ⬜ |
| B3 | Confirm the attach | Stats populate the result card: duration, distance (**miles**), calories, avg HR, max HR — all on one row, no wrap | ⬜ |
| B4 | ~~Check the heatmap~~ | **N/A — route/heatmap DROPPED 2026-07-04** (Apple provides no route for football; distance still shows) | N/A |
| B5 | Check the trend graph on your Stats/Match Fitness screen | Trend shows from the first logged game, with axis titles | ⬜ |

## C. Indoor game — the no-GPS path

| # | Step | Expected | Result |
|---|---|---|---|
| C1 | Record an **Indoor** Apple Soccer workout, attach it to an indoor casual game | Attaches successfully | ⬜ |
| C2 | Check the card | HR / calories / duration show; **distance hidden** (no GPS). (Heatmap N/A — dropped 2026-07-04.) | ⬜ |

## D. Edge cases

| # | Step | Expected | Result |
|---|---|---|---|
| D1 | Have **two** workouts in the game's time window → attach | Multi-workout **picker** appears; you choose one; the chosen one attaches | ⬜ |
| D2 | Attach immediately after Full Time (watch→phone sync lag) | It **retries** rather than flat-failing "no workouts"; the workout appears once synced | ⬜ |
| D3 | Confirm the same game can't double-attach | Once attached, the attach affordance is replaced by the stats (no duplicate) | ⬜ |

## E. Under-18 protection

| # | Step | Expected | Result |
|---|---|---|---|
| E1 | On an account with DOB < 18 (or decline the 18+ age gate) | The attach flow is **not offered / blocked**; no health data is read or saved | ⬜ |
| E2 | (If testable) a known-under-18 account attempts a save | Server **rejects** it | ⬜ |

## F. Consent / sharing

| # | Step | Expected | Result |
|---|---|---|---|
| F1 | Default state of the "share match fitness" toggle (Profile) | **OFF** | ⬜ |
| F2 | The one-time share opt-in prompt after an attach | Appears once; if you're already sharing it never nags | ⬜ |
| F3 | Turn sharing ON, view a squad board / head-to-head with a consenting teammate | Your figures appear in the comparison | ⬜ |
| F4 | Turn sharing OFF again | You **immediately drop out** of others' comparisons on the next load | ⬜ |

---

## Apple-review empty-state risk (awareness, not a test)

If an Apple reviewer ever re-opens this build on a device with **no** soccer workouts, they see
an empty screen and could reject it as "feature not functional." Mitigated by the reviewer note
already on file (read-only of the user's own workouts; empty until the user records one). No
action unless a rejection references it.

---

## On completion

- **All PASS** → the G5 gate is clear. Combined with a signed DPIA (`MATCH_FITNESS_DPIA_ADDENDUM.md`),
  you can flip `VITE_HEALTH_KIT_ENABLED=true` in the `apps/inorout` Vercel env, then run the
  post-flip allowlist-removal cleanup (see `GO_LIVE_ISSUES.md`).
- **Any FAIL** → record it in `BUGS.md`, don't flip the flag, and raise it back to dev.
