// @platform/core/telemetry — the ONE place product analytics events are emitted.
//
// Every `posthog.capture(...)` in the codebase must go through `track()` here.
// This is enforced mechanically (check-hygiene CHECK 9 bans posthog.capture
// outside this file) for the same reason raw database RPC calls are confined
// to supabase.js: a single chokepoint is the only way to guarantee that EVERY
// event, from every app and every future call site, carries the same stamps and
// respects the same suppression rules. You cannot forget a rule at a call site
// that has no rules.
//
// What this guarantees on every event:
//   • event_version — so an event's shape can evolve without renaming it
//   • app           — which of the 8 apps emitted it (cannot be backfilled)
//   • active_hat / hats — WHO the person was acting as (populated once an app
//                    registers a context getter; absent until then)
// What it enforces:
//   • hard suppression on localhost / automated browsers (Playwright, CI) so our
//     own e2e and nightly runs never pollute the production dataset
//   • never emit for a user known to be under 18 (ICO Children's Code)
//   • once-per-session sampling for high-volume events (opt in per call), while
//     low-volume anchor events always send
//
// The contract of event names + their consumers lives in /TELEMETRY.md and is
// checked by skills/scripts/check-telemetry-contract.sh. Add properties freely;
// never rename or remove an event once a dashboard depends on it.

// Bump only on a breaking change to the SHAPE of many events at once. Per-event
// shape changes are additive (add a property) and do not touch this.
const EVENT_VERSION = 1;

// Fraction of *sampled* events (opts.sampled === true) kept, decided ONCE per
// session and held for its lifetime — per-event sampling would shred funnels.
// Anchor events (the default, opts.sampled falsy) ignore this and always send.
// One named constant so the rate can be turned up/down without a code hunt.
const SAMPLE_RATE = 0.25;

let _app = null;          // set by configureTelemetry — which app is emitting
let _getContext = null;   // optional () => { activeHat, hats, isMinor }

// Called once at app startup. `app` names the emitting app; `getContext`, when
// provided (PR that identifies all personas), lets every event carry the active
// hat + minor status without threading them through each call site.
export function configureTelemetry({ app, getContext } = {}) {
  if (typeof app === "string" && app) _app = app;
  if (typeof getContext === "function") _getContext = getContext;
}

// True in any environment whose events must never reach the production project:
// local dev, and automated browsers (Playwright sets navigator.webdriver, which
// also covers the CI/nightly lane). This is what stops our own test runs — and
// the done-checks in this very epic — from minting fake people and skewing DAU.
function isSuppressedEnv() {
  if (typeof window === "undefined") return true; // SSR / node / serverless
  try {
    const h = (window.location && window.location.hostname) || "";
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;
    if (typeof navigator !== "undefined" && navigator.webdriver) return true;
  } catch (e) {
    return true; // if we can't tell, don't send
  }
  return false;
}

// Keep/drop decision for sampled events — made once, then remembered for the
// session. Storage failure fails OPEN (keep) rather than silently dropping data.
function sessionSampleKeep() {
  try {
    const KEY = "io_tel_sample_v1";
    let v = sessionStorage.getItem(KEY);
    if (v === null) {
      v = Math.random() < SAMPLE_RATE ? "keep" : "drop";
      sessionStorage.setItem(KEY, v);
    }
    return v === "keep";
  } catch (e) {
    return true;
  }
}

// Emit one product-analytics event.
//   name  — snake_case, object_action, must appear in /TELEMETRY.md
//   props — event properties (NEVER PII: no name/email/phone/dob/token)
//   opts.sampled — true for high-volume events (e.g. screen views); they are
//                  session-sampled. Omit for low-volume anchor events.
export function track(name, props, opts) {
  try {
    if (!name || typeof name !== "string") return;
    if (isSuppressedEnv()) return;
    const ph = typeof window !== "undefined" ? window.posthog : null;
    if (!ph || typeof ph.capture !== "function") return;

    const ctx = _getContext ? _getContext() || {} : {};
    // Never build a profile for a user known to be under 18.
    if (ctx.isMinor === true) return;

    const sampled = !!(opts && opts.sampled);
    if (sampled && !sessionSampleKeep()) return;

    ph.capture(name, {
      ...(props || {}),
      event_version: EVENT_VERSION,
      app: _app || undefined,
      active_hat: ctx.activeHat || undefined,
      hats: ctx.hats || undefined,
    });
  } catch (e) {
    // Analytics must never break a user flow.
    console.error("telemetry track failed:", e);
  }
}
