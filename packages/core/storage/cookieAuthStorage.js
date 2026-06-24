// Cross-subdomain auth-session storage for the In or Out platform (Phase 0e).
//
// THE PROBLEM 0e SOLVES
// All 8 apps share ONE Supabase project, so every app already computes the SAME
// storageKey (`sb-<ref>-auth-token`). The only thing stopping a sign-in on
// app.in-or-out.com from carrying to venue.in-or-out.com is that the default
// supabase-js storage is per-ORIGIN localStorage. This adapter writes the session
// to a COOKIE scoped to the shared parent domain instead, so ONE sign-in works on
// every `*.in-or-out.com` subdomain — no per-nav token handoff.
//
// SAFE BY DEFAULT (ship-dark, the 0c precedent)
// It only engages when `VITE_AUTH_COOKIE_DOMAIN` is set (operator sets it per
// Vercel project once the subdomains are attached). When unset it is byte-
// identical to the default localStorage behaviour, so merging is a no-op until
// the operator flips it on.
//
// NATIVE-GUARDED
// Inside the Capacitor wrapper it ALWAYS uses localStorage — the native shell's
// proven `#access_token` → /auth/callback flow (app-store F4) must not change, and
// WKWebView cookies are unreliable across launches. `window.Capacitor` is injected
// by the native bridge before the app bundle runs, so the guard is reliable.
//
// SECURITY (see DECISIONS.md, Phase 0e)
// Cookie is `SameSite=Lax; Secure`, readable by JS on any subdomain (HttpOnly is
// impossible — supabase-js reads the session from JS). Supabase APIs authorise off
// the `Authorization: Bearer` header that JS sets, NOT an auto-sent cookie, so
// there is NO classic cookie-CSRF surface. The trade-off is a wider XSS blast
// radius across subdomains than per-origin localStorage — accepted, mitigated by
// keeping the subdomain set tight + CSP.

const COOKIE_DOMAIN = import.meta.env.VITE_AUTH_COOKIE_DOMAIN || null;
const CHUNK = 3000;     // keep each cookie comfortably under the 4KB per-cookie cap
const MAX_CHUNKS = 24;  // hard stop so a malformed read can never loop unbounded

function isNative() {
  if (typeof window === "undefined") return false;
  // Trust the deterministic flag stamped by the native wrap's main.jsx FIRST
  // (set synchronously via @capacitor/core's isNativePlatform() before any
  // storage read). The live `window.Capacitor` bridge check is a fallback for
  // any path that runs before the flag is set — but for a remote-server.url
  // WKWebView that check can read false even in the wrap, which is exactly the
  // bug this flag closes. Native → ALWAYS localStorage (shared cookies don't
  // persist across launches in WKWebView → refresh-token storm → logout).
  if (window.__CAP_NATIVE__ === true) return true;
  return window.Capacitor?.isNativePlatform?.() === true;
}

// Cookie storage engages only when a parent domain is configured AND we are not
// inside the native wrapper. Otherwise fall back to localStorage so dev,
// *.vercel.app previews, Playwright, and the native app are all unchanged.
function cookieMode() {
  return !!COOKIE_DOMAIN && typeof document !== "undefined" && !isNative();
}

function lsGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* unavailable */ }
}
function lsRemove(key) {
  try { window.localStorage.removeItem(key); } catch { /* unavailable */ }
}

function writeCookie(name, value) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${name}=${value}; Domain=${COOKIE_DOMAIN}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
function deleteCookie(name) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${name}=; Domain=${COOKIE_DOMAIN}; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
function readCookie(name) {
  const prefix = name + "=";
  const all = document.cookie ? document.cookie.split("; ") : [];
  for (const c of all) if (c.startsWith(prefix)) return c.slice(prefix.length);
  return null;
}

function clearCookieSet(key) {
  deleteCookie(key);
  for (let i = 0; i < MAX_CHUNKS; i++) deleteCookie(`${key}.${i}`);
}

function getItem(key) {
  if (!cookieMode()) return lsGet(key);
  // Single unchunked cookie first, then reassemble chunks (key.0, key.1, …).
  const single = readCookie(key);
  if (single != null) return decodeURIComponent(single);
  let out = "", found = false;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = readCookie(`${key}.${i}`);
    if (part == null) break;
    out += part; found = true;
  }
  if (found) return decodeURIComponent(out);
  // Cookie absent — a session written to localStorage BEFORE the cookie flip, OR
  // a cookie that was silently dropped (WKWebView/Safari evict cookies on their
  // own schedule). Fall back to the durable localStorage mirror. NON-DESTRUCTIVE:
  // no write-on-read — the next setItem from supabase-js's auto-refresh repopulates
  // the cookie naturally. (The old code did setItem() here, a write-on-read that
  // combined with the destructive lsRemove below to guarantee a read/write
  // disagreement whenever a cookie write was dropped.)
  return lsGet(key);
}

function setItem(key, value) {
  if (!cookieMode()) { lsSet(key, value); return; }
  // Always keep a same-origin localStorage MIRROR as a durable fallback. The
  // cookie is the cross-subdomain source of truth for SSO, but if the browser
  // drops it the mirror means a dropped cookie degrades to a silent re-read,
  // never a logged-out session that triggers a refresh-token storm. (Previously
  // this lsRemove'd the copy unconditionally — so a dropped cookie wiped the
  // session from BOTH stores. getItem prefers the cookie, so the mirror is only
  // consulted when the cookie is genuinely gone.)
  lsSet(key, value);
  const enc = encodeURIComponent(value);
  clearCookieSet(key); // drop any prior representation (single + stale chunks)
  if (enc.length <= CHUNK) {
    writeCookie(key, enc);
  } else {
    for (let i = 0, o = 0; o < enc.length && i < MAX_CHUNKS; i++, o += CHUNK) {
      writeCookie(`${key}.${i}`, enc.slice(o, o + CHUNK));
    }
  }
}

function removeItem(key) {
  if (!cookieMode()) { lsRemove(key); return; }
  clearCookieSet(key);
  lsRemove(key);
}

// supabase-js storage interface (sync is fine). Exported as a plain object with
// no `this` use so destructuring by the SDK can't break it.
export const cookieAuthStorage = { getItem, setItem, removeItem };

// True when the shared-cookie SSO path is live in this build/runtime (web, parent
// domain configured, not native). Handy for diagnostics / conditional UI.
export const SHARED_COOKIE_AUTH = cookieMode();
