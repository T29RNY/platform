import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import "./theme/tokens.css";
import App from "./App.jsx";
import { initNativeShell } from "./native/native-shell.js";

// Deterministic native detection for the auth-storage guard. `@capacitor/core`'s
// isNativePlatform() is reliable (it does NOT depend on window.webkit bridge
// handlers, which can be absent in a remote-server.url WKWebView). We stamp the
// verdict on a global synchronously here, BEFORE React renders. supabase-js reads
// its storage lazily on a microtask after this module body runs, so the flag is
// always set first — the cookie-storage adapter trusts it to force localStorage
// in the native wrap (where shared cookies do not persist across launches) while
// leaving web SSO untouched. See packages/core/storage/cookieAuthStorage.js.
window.__CAP_NATIVE__ = Capacitor.isNativePlatform();

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
