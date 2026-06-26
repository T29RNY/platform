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
// WKWebView cookies are unreliable across launches. The `__CAP_NATIVE__` flag and
// the `window.Capacitor` bridge check are the FIRST line of defence.
//
// SELF-HEAL (app-store rejection #2, build 1.0(4))
// The native guard above is NOT sufficient on its own. App Review hit a refresh-
// token storm on an iPad: `Capacitor.isNativePlatform()` returned false in the
// remote-`server.url` WKWebView, so the guard let cookie mode engage — and WKWebView
// then returned stale/partial cookie reads inside a single session, so supabase-js
// rotated its refresh token 47× in 44s before the server 429'd it and logged the
// user out. The localStorage mirror did NOT save it: getItem only consults the
// mirror when the cookie is fully ABSENT, not when it reads back WRONG.
// So storage now SELF-HEALS independently of native detection: every cookie write
// is read straight back, and the first time the read-back does not match what was
// written we conclude this runtime's cookie store is unreliable and latch to
// localStorage-only for the rest of the page session (the mirror is always written
// first, so the live session is never lost). In-memory only — never persisted — so
// a one-off glitch on a healthy web browser can't permanently disable SSO; each
// launch re-evaluates and a genuinely broken store simply re-latches within one
// refresh cycle. Healthy browsers round-trip exactly and never latch.
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

// Latched the first time a cookie write fails to read back identically (see
// SELF-HEAL above). In-memory only, never persisted. Once true, this runtime
// treats its cookie store as unreliable and uses localStorage exclusively.
let cookiesUnreliable = false;

function isNative() {
  if (typeof window === "undefined") return false;
  // UA marker FIRST (capacitor.config `appendUserAgent`, mirrored in the app's
  // is-native.js). It's baked into the WKWebView User-Agent at the native config
  // level — present from the first line of JS, immune to the bridge-injection
  // timing that read FALSE in the remote-server.url WKWebView on the App Review
  // iPad (the root cause of both rejections). Checked here directly so storage is
  // robust even on a read that races main.jsx's flag stamp. Then the flag, then the
  // live bridge. Native → ALWAYS localStorage (shared cookies don't persist across
  // launches in WKWebView → refresh-token storm → logout).
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  if (ua.includes("InorOutApp")) return true;
  if (window.__CAP_NATIVE__ === true) return true;
  return window.Capacitor?.isNativePlatform?.() === true;
}

// Cookie storage engages only when a parent domain is configured AND we are not
// inside the native wrapper. Otherwise fall back to localStorage so dev,
// *.vercel.app previews, Playwright, and the native app are all unchanged.
function cookieMode() {
  return (
    !!COOKIE_DOMAIN &&
    typeof document !== "undefined" &&
    !isNative() &&
    !cookiesUnreliable
  );
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

// Reassemble the stored value from cookies: a single unchunked cookie first, then
// chunked cookies (key.0, key.1, …). Returns the decoded string, or null when no
// cookie representation is present at all. Shared by getItem (read path) and
// setItem (write-back verification).
function readCookieValue(key) {
  const single = readCookie(key);
  if (single != null) return decodeURIComponent(single);
  let out = "", found = false;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = readCookie(`${key}.${i}`);
    if (part == null) break;
    out += part; found = true;
  }
  return found ? decodeURIComponent(out) : null;
}

function getItem(key) {
  if (!cookieMode()) return lsGet(key);
  // A cookie that reads back PRESENT-but-stale (not absent) is returned as-is here:
  // getItem can't safely prefer the mirror, because in cross-subdomain SSO a newer
  // session legitimately lands in the shared cookie ahead of this origin's mirror,
  // so "cookie != mirror" does NOT imply the cookie is wrong. The WKWebView stale-
  // read storm is closed at the source instead — native uses localStorage only
  // (the UA-marker detector, Option 2). A decode error never escapes — degrade to
  // the mirror.
  let fromCookie = null;
  try { fromCookie = readCookieValue(key); } catch { fromCookie = null; }
  if (fromCookie != null) return fromCookie;
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
  // SELF-HEAL: confirm the cookie store actually accepted the write. If reading it
  // straight back does not reproduce `value`, this runtime's cookie store is
  // unreliable (the WKWebView app-store-rejection case) — latch to localStorage-only
  // for the rest of the session. The mirror written above already holds `value`, so
  // getItem returns the correct session immediately and supabase-js never enters the
  // refresh-token storm. A decode error (corrupt/truncated chunk) counts as a
  // mismatch — it must never throw out of setItem. The only theoretical false
  // positive (a second subdomain writing a newer session into the shared cookie in
  // the sub-microsecond gap between this write and read — already serialised by
  // supabase's cross-tab lock) merely DEGRADES SSO to localStorage for this page
  // load; never a logout, and it resets next load. No-op on healthy browsers.
  let readBack = null;
  try { readBack = readCookieValue(key); } catch { readBack = null; }
  if (readBack !== value) {
    cookiesUnreliable = true;
    console.error(
      "[auth] cookie store unreliable — read-back mismatch; using localStorage only"
    );
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
