import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/tokens.css";
import App from "./App.jsx";
import { initNativeShell } from "./native/native-shell.js";
import { isNativeApp } from "./native/is-native.js";

// Deterministic native detection for the auth-storage guard. We DON'T trust
// `Capacitor.isNativePlatform()` alone: it resolves via the native bridge, which the
// remote-server.url WKWebView read as FALSE on the App Review iPad (the root cause of
// both rejections). `isNativeApp()` keys off the User-Agent marker (capacitor.config
// `appendUserAgent`) first — present from the first line of JS, immune to bridge
// timing — then the flag, then the bridge. We stamp the verdict on a global
// synchronously here, BEFORE React renders, so supabase-js's lazy (microtask) storage
// read sees it: the cookie-storage adapter forces localStorage in the native wrap
// (where shared cookies don't persist) while leaving web SSO untouched.
// See src/native/is-native.js + packages/core/storage/cookieAuthStorage.js.
window.__CAP_NATIVE__ = isNativeApp();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// No-op on web; sets status bar / splash / Android back button in the native wrap.
initNativeShell();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}
