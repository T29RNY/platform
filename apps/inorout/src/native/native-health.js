// Native Apple Health bridge (Match Workout Tracking Phase 1).
//
// One helper layer over the DORMANT `HealthKit` native plugin
// (apps/inorout/ios-plugins/HealthKit/). READ-ONLY: we build no tracking — Apple's stock
// Workout app measures the game; this reads the summary + route so the match-to-game flow
// (PR #6) can attach it to a fixture and post it via saveMatchHealthSummary (mig 456).
//
// WEB / PWA: every function no-ops (returns inert values) — isNativeApp() is false off the
// native wrap, so nothing here touches the live web app. The plugin is also absent from the
// current App-Store binary; it first links when the operator adds it on the build machine
// (gates G2/G3, see ios-plugins/HealthKit/README.md). Until then isNativeApp() may be true
// but the plugin call rejects → caught → inert, never a crash.
//
// HealthKit gotchas baked into the contract (KEY AUDIT FACTS, manifest):
//   • read-denial is INVISIBLE — an empty workout list means denied OR none; the caller
//     must offer a "check Health permissions" path, never assume "no games".
//   • watch→iPhone sync has a delay — the caller should retry, not flat-fail.
//   • indoor games carry the same activity type with an `indoor` flag + no route.

import { isNativeApp } from "./is-native.js";

// Resolve the registered native plugin, or null on web / when not in the native wrap.
async function healthPlugin() {
  if (!isNativeApp()) return null;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    return registerPlugin("HealthKit");
  } catch (e) {
    console.error("[health] registerPlugin(HealthKit) failed", e);
    return null;
  }
}

// Test-bed allowlist: specific operator auth-user IDs for whom HealthKit is enabled
// while the global VITE_HEALTH_KIT_ENABLED flag stays OFF. This is a controlled,
// account-scoped dark launch — it lets the operator trial the attach/import flow on a
// real device without turning the feature on for the whole user base (which carries a
// DPIA/consent gate). REMOVE this set when the global flag flips at true go-live.
const HEALTH_TESTBED_UIDS = new Set([
  "11e35b81-5fa7-4bee-b57d-f6e70449b013", // operator (Footy Tuesdays admin) — real-device test bed
]);

// True only inside the native wrap (where the HealthKit plugin can exist). The UI uses this
// to decide whether to offer the "connect Apple Health" affordance at all (hidden on web).
// Enabled when EITHER the global flag is 'true' (full go-live) OR the signed-in user is on
// the test-bed allowlist (account-scoped dark launch). `userId` is the signed-in auth uid,
// threaded from the caller (which already loads the session); null → global-flag path only.
// VITE_HEALTH_KIT_ENABLED must be 'true' for the public path (set after G2/G3 native build).
export function isHealthAvailable(userId = null) {
  if (!isNativeApp()) return false;
  if (import.meta.env.VITE_HEALTH_KIT_ENABLED === 'true') return true;
  return !!userId && HEALTH_TESTBED_UIDS.has(userId);
}

// Prompt for READ access to workouts + distance/HR/active-energy + route. Returns
// { available, granted }. `granted` only means the prompt completed (HealthKit never
// reveals true read-grant state — see the Swift note); treat an empty queryWorkouts result
// as denied-or-empty downstream.
export async function requestHealthAuth() {
  const p = await healthPlugin();
  if (!p) return { available: false, granted: false };
  try {
    const r = await p.requestAuthorization();
    return { available: true, granted: !!r?.granted };
  } catch (e) {
    console.error("[health] requestAuthorization failed", e);
    return { available: true, granted: false, error: String(e) };
  }
}

// List Apple workouts in [fromISO, toISO]. Returns an array of summaries
// ({ uuid, startISO, endISO, durationSeconds, distanceMeters, activeEnergyKcal, avgHr,
//   maxHr, indoor, activityType }) or [] on web / error / none. uuid = HKWorkout.uuid =
// the idempotency key fed to saveMatchHealthSummary as clientSessionId.
export async function queryWorkouts({ fromISO, toISO } = {}) {
  const p = await healthPlugin();
  if (!p) return [];
  if (!fromISO || !toISO) return [];
  try {
    const r = await p.queryWorkouts({ fromISO, toISO });
    return Array.isArray(r?.workouts) ? r.workouts : [];
  } catch (e) {
    console.error("[health] queryWorkouts failed", e);
    return [];
  }
}

// GPS route for one workout (outdoor only). Returns the track jsonb
// ({ points: [{ lat, lon, t }] }) or null on web / indoor / no-route / error. Fed straight
// to saveMatchHealthSummary's `route` param and getMatchRoute's heatmap renderer.
export async function queryRoute(workoutUuid) {
  const p = await healthPlugin();
  if (!p || !workoutUuid) return null;
  try {
    const r = await p.queryRoute({ workoutUuid });
    return r?.track ?? null;
  } catch (e) {
    console.error("[health] queryRoute failed", e);
    return null;
  }
}
