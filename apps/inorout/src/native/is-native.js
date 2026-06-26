import { Capacitor } from "@capacitor/core";

// Robust native-app detection — ONE source of truth for "are we inside the native
// wrap?", used by storage selection, the native shell, OAuth path choice, and push.
//
// WHY THIS EXISTS (the root cause of BOTH App Store rejections)
// `Capacitor.isNativePlatform()` resolves the platform from the native bridge that
// WKWebView injects. With a remote `server.url`, that injection can be absent or late
// on first paint — App Review's iPad read it as FALSE inside the wrap, so the app
// fell into web (cookie) mode and stormed. The fix is a signal that does NOT depend on
// bridge timing: a marker appended to the WebView's User-Agent via capacitor.config
// `appendUserAgent`. The native build bakes it into the UA, so it is present from the
// very first line of JS, deterministically.
//
// Order: UA marker (most reliable) → the flag main.jsx stamps → the live bridge check
// (last resort). Until a binary ships WITH `appendUserAgent`, the marker is absent and
// this is byte-equivalent to `isNativePlatform()` — inert on web and on the current
// binary, lighting up only in the build that sets the marker.
export const NATIVE_UA_MARKER = "InorOutApp";

export function isNativeApp() {
  if (typeof navigator !== "undefined" &&
      navigator.userAgent &&
      navigator.userAgent.includes(NATIVE_UA_MARKER)) {
    return true;
  }
  if (typeof window !== "undefined" && window.__CAP_NATIVE__ === true) return true;
  return Capacitor.isNativePlatform?.() === true;
}
