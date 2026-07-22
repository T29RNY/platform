// @platform/core/telemetry/consent — analytics opt-IN state.
//
// The product asks permission BEFORE any third-party analytics (UK DUAA 2025 /
// PECR: for person-level analytics, legitimate interest does not cover the
// storage/access step — consent does). PostHog is configured
// `opt_out_capturing_by_default: true`, so nothing — not even an autocaptured
// pageview — leaves the device until the person says yes here.
//
// The decision is stored device-local (localStorage). That is the ICO's "simple
// means of objecting, free of charge", and it works for anonymous players too.
// Account-level sync (so the choice follows a signed-in person across devices)
// is added with the sessions migration; this module is the single place that
// would gain that call, so call sites never change.

const CONSENT_KEY = "io_analytics_consent"; // 'granted' | 'denied'

function ph() {
  return typeof window !== "undefined" ? window.posthog : null;
}

// 'granted' | 'denied' | null (null = not yet asked)
export function getAnalyticsConsent() {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch (e) {
    return null;
  }
}

export function hasAnalyticsDecision() {
  return getAnalyticsConsent() !== null;
}

// Record the person's choice and apply it to PostHog immediately. Granting
// opts in (capture resumes); denying (or a later withdrawal) opts out and, for
// good measure, resets so no identified profile lingers on the device.
export function setAnalyticsConsent(granted) {
  const value = granted ? "granted" : "denied";
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch (e) {
    console.error("consent store failed:", e);
  }
  const p = ph();
  try {
    if (!p) return value;
    if (granted) {
      if (typeof p.opt_in_capturing === "function") p.opt_in_capturing();
    } else {
      if (typeof p.opt_out_capturing === "function") p.opt_out_capturing();
      if (typeof p.reset === "function") p.reset();
      if (typeof p.register === "function") p.register({ app: "inorout" });
    }
  } catch (e) {
    console.error("consent apply failed:", e);
  }
  return value;
}

// Apply the STORED decision to PostHog at startup. PostHog boots opted-out by
// default; if this person previously granted, re-enable capture. If they denied,
// keep it off. If undecided, leave it off (the prompt will ask). Idempotent.
export function syncConsentToPostHog() {
  const decision = getAnalyticsConsent();
  const p = ph();
  if (!p) return decision;
  try {
    if (decision === "granted" && typeof p.opt_in_capturing === "function") {
      p.opt_in_capturing();
    } else if (typeof p.opt_out_capturing === "function") {
      p.opt_out_capturing();
    }
  } catch (e) {
    console.error("consent sync failed:", e);
  }
  return decision;
}
