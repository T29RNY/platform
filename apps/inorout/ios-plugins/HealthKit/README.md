# HealthKit native plugin (DORMANT — Match Workout Tracking Phase 1)

Read-only Capacitor plugin over Apple Health. We build **no tracking** — Apple's stock
Workout app measures the game; this plugin **reads** the workout summary + GPS route so the
app can match it to a fixture and post it via `save_match_health_summary` (mig 456).

Like `../AuthSession/`, this lives **outside** the gitignored `ios/` folder and is **dragged
into the Xcode App target by hand**. It is reference source — **not compiled in CI** (no Swift
toolchain) and present in **no binary** until the steps below are done on the build machine.
The JS bridge (`src/native/native-health.js`) **no-ops on web**, so this is inert in the live
web app and in the current App-Store binary.

## Files
- `HealthKitPlugin.swift` — the `CAPPlugin` (requestAuthorization / queryWorkouts / queryRoute).
- `HealthKitPlugin.m` — Capacitor `CAP_PLUGIN` registration (exposes it to JS as `HealthKit`).

## JS surface (`registerPlugin('HealthKit')`, wrapped in `src/native/native-health.js`)
- `requestAuthorization()` → `{ available, granted }`
- `queryWorkouts({ fromISO, toISO })` → `{ workouts: [{ uuid, startISO, endISO, durationSeconds,
  distanceMeters, activeEnergyKcal, avgHr, maxHr, indoor, activityType }] }`
- `queryRoute({ workoutUuid })` → `{ track: { points: [{ lat, lon, t }] } | null }`

## Mac / build-machine activation (gates G2 + G3 — operator)

1. **Apple Developer portal (G2):** App ID `uk.inorout.app` → enable the **HealthKit**
   capability. Regenerate the provisioning profile.

2. **Xcode — capability (G3):** target → Signing & Capabilities → **+ Capability → HealthKit**.
   (Do **not** tick "Clinical Health Records" — we only read workouts/fitness.)

3. **Xcode — Info.plist usage string (G3):** add
   `NSHealthShareUsageDescription` =
   *"In or Out reads your Apple Watch workouts to show your match fitness and route for games
   you choose to track. It is never shared without your permission and we never write to Health."*
   (No `NSHealthUpdateUsageDescription` — we request **read** only.)

4. **Drag the plugin into the target (G3):** drag **both** `HealthKitPlugin.swift` and
   `HealthKitPlugin.m` into the **App** target in Xcode (Copy items if needed = off; they live
   here, outside `ios/`). Confirm both show under the target's *Compile Sources*.

5. **⚠️ REGISTER THE PLUGIN (G3 — DO NOT SKIP; this is what build 1.1.0(10) missed):**
   The `CAP_PLUGIN` macro **alone does NOT register an app-embedded plugin in Capacitor 6+**
   — the bridge only auto-registers npm-package plugins listed in `capacitor.config.json`.
   You must register the instance explicitly. In the **gitignored `ios/` folder** (so it is
   **wiped by `npx cap sync` / any `ios/` regen and must be re-applied every time**):
   - Create `ios/App/App/MainViewController.swift` — a `CAPBridgeViewController` subclass whose
     `capacitorDidLoad()` calls `bridge?.registerPluginInstance(HealthKitPlugin())`.
   - In `ios/App/App/Base.lproj/Main.storyboard`, set the view controller's
     `customClass="MainViewController"` (`customModule="App"`).
   - **Proof it worked:** the device console prints
     `[MainViewController] capacitorDidLoad — registering HealthKit plugin instance` on launch.
     If that line is absent, the plugin is NOT registered and every call throws
     `"HealthKit" plugin is not implemented on ios` (the plugin-level Capacitor error — distinct
     from the JS `.then()` thenable-hang, which is a different bug). **Build 1.1.0(10) shipped
     without this step and Apple Health was dead for every App Store user until 1.1.0(11).**

6. **Sync + build (G3):** `npx cap sync ios`, then archive → TestFlight. `npx cap sync` does
   **not** copy the plugin files (they're outside `ios/`); they're wired by the drag in step 4.
   **It DOES clobber step 5's `MainViewController.swift` + storyboard edit — re-apply them after
   every sync, immediately before archiving.**

7. **Verify on device (G5):** grant then deny HealthKit; record an Apple **Soccer** workout
   (outdoor + indoor); confirm `queryWorkouts` returns it and `queryRoute` returns coordinates
   for the outdoor one / `null` for indoor. Read-denial is invisible (empty list = denied OR
   none) — the app routes that to a "check Health permissions" path.

## App Store note (G4)
Submitting with HealthKit re-arms the review freeze and requires the **App Privacy →
Health & Fitness** answers + a reviewer note (read-only of the user's own Apple workouts; we
write only our own summary to our backend; nothing stored in iCloud; no ads/data-mining) and a
privacy-policy "Apple Health" section. See `APP_STORE_CHECKLIST.md`.
