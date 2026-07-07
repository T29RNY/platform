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
import { registerPlugin } from "@capacitor/core";

// Resolve the registered native plugin, or null on web / when not in the native wrap.
//
// SYNCHRONOUS BY DESIGN — and callers MUST NOT `await` the return value; call a METHOD on
// it and await THAT. registerPlugin() returns a Proxy whose get-handler returns a function
// for ANY property, INCLUDING `.then`, so the proxy is accidentally "thenable". Returning it
// out of an async function (or `await`ing it directly) triggers Promise thenable-assimilation:
// Promise.resolve(proxy) calls proxy.then(resolve, reject), which the proxy treats as a native
// plugin method named "then" — it throws "HealthKit.then() is not implemented on ios" and NEVER
// calls resolve/reject, so the await HANGS FOREVER (before any downstream withTimeout can fire).
// That was the "stuck on Requesting Health access…" hang: proven in-device via an unhandled
// "HealthKit.then() is not implemented" rejection. Keeping this sync + un-awaited is the fix.
//
// registerPlugin() is also cached here so it is called once per plugin name (a repeat call only
// logs a warning and returns the same proxy).
// (`undefined` = not yet attempted, `null` = unavailable, else the live proxy.)
let _healthPluginProxy;
function healthPlugin() {
  if (!isNativeApp()) return null;
  if (_healthPluginProxy !== undefined) return _healthPluginProxy;
  try {
    _healthPluginProxy = registerPlugin("HealthKit");
  } catch (e) {
    console.error("[health] registerPlugin(HealthKit) failed", e);
    _healthPluginProxy = null;
  }
  return _healthPluginProxy;
}

// True only inside the native wrap (where the HealthKit plugin can exist). The UI uses this
// to decide whether to offer the "connect Apple Health" affordance at all (hidden on web).
// Gated by the global VITE_HEALTH_KIT_ENABLED flag. As of 2026-07-07 this flag is still OFF in
// production (the Vercel env var exists but is set to "", so this returns false for everyone and
// the feature is dark). The DPIA (MATCH_FITNESS_DPIA_ADDENDUM.md) IS signed (2026-07-07), but the
// G5 real-device walk (MATCH_FITNESS_G5_DEVICE_WALK.md) is still outstanding — DO NOT flip the flag
// to 'true' until G5 passes. Caveat that shapes the G5 plan: the per-operator test-bed allowlist
// that used to reveal the attach flow while the flag was off has already been removed from this
// file, so the ONLY way to exercise the flow today is with the flag on for all native users.
export function isHealthAvailable() {
  if (!isNativeApp()) return false;
  return import.meta.env.VITE_HEALTH_KIT_ENABLED === 'true';
}

// Cap a native bridge call that never settles. The HealthKit consent request can hang if
// the OS sheet fails to present (see HealthKitPlugin.swift's main-thread note); without a
// timeout the attach UI would spin forever on "Requesting Health access…". On timeout we
// reject so the caller can surface a readable error instead of freezing.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

// Prompt for READ access to workouts + distance/HR/active-energy + route. Returns
// { available, granted, error? }. `granted` only means the prompt completed (HealthKit
// never reveals true read-grant state — see the Swift note); treat an empty queryWorkouts
// result as denied-or-empty downstream. A hang/timeout returns available:false + a
// human-readable error so the UI shows a message rather than spinning forever.
export async function requestHealthAuth() {
  const p = healthPlugin();
  if (!p) return { available: false, granted: false };
  try {
    // First-time consent can be slow to present the system sheet (the OS builds the Health
    // UI on first use). Keep the timeout generous so a slow-but-working first grant doesn't
    // false-error while the modal sheet is still coming up.
    const r = await withTimeout(p.requestAuthorization(), 60000, "Apple Health permission request");
    return { available: true, granted: !!r?.granted };
  } catch (e) {
    console.error("[health] requestAuthorization failed", e);
    return {
      available: false,
      granted: false,
      error: `Couldn't reach Apple Health — the permission prompt didn't appear (${String(e?.message || e)}). Try again; if it persists, check Settings › Privacy & Security › Health.`,
    };
  }
}

// List Apple workouts in [fromISO, toISO]. Returns an array of summaries
// ({ uuid, startISO, endISO, durationSeconds, distanceMeters, activeEnergyKcal, avgHr,
//   maxHr, indoor, activityType }) or [] on web / error / none. uuid = HKWorkout.uuid =
// the idempotency key fed to saveMatchHealthSummary as clientSessionId.
export async function queryWorkouts({ fromISO, toISO } = {}) {
  const p = healthPlugin();
  if (!p) return [];
  if (!fromISO || !toISO) return [];
  try {
    const r = await withTimeout(p.queryWorkouts({ fromISO, toISO }), 15000, "Apple Health workout query");
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
  const p = healthPlugin();
  if (!p || !workoutUuid) return null;
  try {
    const r = await withTimeout(p.queryRoute({ workoutUuid }), 15000, "Apple Health route query");
    return r?.track ?? null;
  } catch (e) {
    console.error("[health] queryRoute failed", e);
    return null;
  }
}
