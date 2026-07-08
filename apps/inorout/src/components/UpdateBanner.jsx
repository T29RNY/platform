import { useEffect, useState } from "react";
import { X, ArrowClockwise } from "@phosphor-icons/react";
import { isNativeApp } from "../native/is-native.js";

// App Store "update available" nudge — NATIVE iOS ONLY.
//
// Asks Apple directly (the public iTunes lookup endpoint) for the current App Store version,
// compares it to the installed build (Capacitor App.getInfo), and shows a dismissible banner if
// the user is behind. Tapping Update opens the native App Store page (where the Update button is).
//
// Self-hides in every other case: on web (isNativeApp false), on any fetch/parse failure, when the
// user is already up to date, and once dismissed FOR THAT VERSION — a newer store version re-shows
// it (dismissal is per-version, keyed in localStorage, never a permanent silence).
//
// CORS note: a browser fetch() to itunes.apple.com is not reliably CORS-enabled, so the request
// goes through CapacitorHttp (a NATIVE request that bypasses CORS). Zero maintenance — the store
// version is read live from Apple, nothing to bump on release.

const DISMISS_KEY = "io_update_dismissed_version";
const BUNDLE_ID = "uk.inorout.app";

// True when version string `a` is older than `b`, compared numerically dot-by-dot
// (so 1.10.0 is correctly newer than 1.9.0 — a plain string compare would get this wrong).
function isOlder(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

export default function UpdateBanner() {
  const [info, setInfo] = useState(null); // { storeVersion, trackId } once an update is confirmed
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    let alive = true;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const { CapacitorHttp } = await import("@capacitor/core");
        const { version: installed } = await App.getInfo();
        // Cache-bust so an old cached lookup never masks a fresh release.
        const res = await CapacitorHttp.get({
          url: `https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}&t=${Date.now()}`,
        });
        const data = typeof res?.data === "string" ? JSON.parse(res.data) : res?.data;
        const app = data?.results?.[0];
        if (!alive || !installed || !app?.version) return;
        if (!isOlder(installed, app.version)) return; // up to date → nothing to show
        if (localStorage.getItem(DISMISS_KEY) === app.version) return; // dismissed for this version
        setInfo({ storeVersion: app.version, trackId: app.trackId });
      } catch (e) {
        console.error("[update-banner] version check failed", e);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!info || hidden) return null;

  const openStore = () => {
    // itms-apps:// hands off to the native App Store app, landing on our page's Update button.
    if (info.trackId) window.location.href = `itms-apps://apps.apple.com/app/id${info.trackId}`;
  };
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, info.storeVersion); } catch (e) { /* localStorage unavailable — just hide */ }
    setHidden(true);
  };

  // Top-of-screen bar: pad past the status bar / notch (safe-area-inset-top) so the copy never
  // renders under the clock + battery. Matches the LiveMatchSheet / PageHeader top-bar idiom.
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px", background: "var(--s2)", borderBottom: "0.5px solid var(--b2)", fontFamily: "var(--font-body)" }}>
      <span style={{ flex: 1, fontSize: 13, color: "var(--t1)" }}>A new version of In or Out is available.</span>
      <button
        type="button"
        onClick={openStore}
        style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "0.5px solid var(--gold)", borderRadius: "var(--r)", color: "var(--gold)", fontSize: 12, fontWeight: 600, padding: "5px 12px", cursor: "pointer", fontFamily: "var(--font-body)", WebkitTapHighlightColor: "transparent" }}
      >
        <ArrowClockwise size={14} weight="thin" /> Update
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{ background: "none", border: "none", color: "var(--t2)", cursor: "pointer", padding: 4, display: "flex", WebkitTapHighlightColor: "transparent" }}
      >
        <X size={16} weight="thin" />
      </button>
    </div>
  );
}
