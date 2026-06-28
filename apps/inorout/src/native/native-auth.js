// Native OAuth bridge (Stage 3.6 of the app-store epic).
//
// One helper, two paths. On the web (PWA / browser) startOAuth is a thin
// pass-through to supabase.auth.signInWithOAuth — BYTE-IDENTICAL to the old
// inline calls, so the live web sign-in is unchanged. Inside the Capacitor
// wrapper it switches to the system-browser flow Google/Apple require.
//
// Why the native path exists:
//   Google (and Apple) refuse signInWithOAuth's full-page redirect inside an
//   embedded WebView (`disallowed_useragent`). Fix = open the provider URL in
//   the SYSTEM browser and return to the app via a custom-scheme deep link.
//
// How the PKCE exchange completes:
//   skipBrowserRedirect:true makes supabase store the PKCE verifier in THIS
//   webview's localStorage and hand us data.url instead of navigating. We open
//   data.url with @capacitor/browser; the provider redirects to
//   uk.inorout.app://auth/callback?code=… ; the OS hands that to the app and
//   native-shell's appUrlOpen handler calls exchangeCodeForSession — the
//   verifier never left this webview, so the exchange succeeds and
//   onAuthStateChange (App.jsx) picks up the session.
//
// DORMANT until: 👤 allowlists uk.inorout.app://auth/callback in Supabase Auth
// → URL Configuration → Redirect URLs, AND the native build registers the
// scheme (CFBundleURLTypes / intent-filter). Same shape as 3.5's APNs/FCM —
// the web path never touches any of this.

import { supabase } from '@platform/core/storage/supabase.js';
import { isNativeApp } from './is-native.js';

// The custom-scheme deep link the provider redirects back to. Must match the
// scheme the native build registers and the Supabase Auth redirect allowlist.
export const NATIVE_AUTH_REDIRECT = 'uk.inorout.app://auth/callback';

// The app's BUNDLE ID — the audience of the native Apple identity token. iOS ignores
// the plugin's clientId/redirectURI (it uses the app entitlement), but Supabase's
// Apple provider MUST list this in its Authorized Client IDs or signInWithIdToken
// rejects the token's audience. (The web leg uses the Service ID uk.inorout.app.signin;
// both must be authorized for web + native sign-in to coexist.)
const APPLE_NATIVE_CLIENT_ID = 'uk.inorout.app';

// Custom URL scheme half of NATIVE_AUTH_REDIRECT — used by the authsession opener.
const NATIVE_AUTH_SCHEME = 'uk.inorout.app';

// Which iOS opener finishes the OAuth round-trip. DORMANT FALLBACK (Stage 5.3 /
// F4). Two values:
//   'browser'     — @capacitor/browser (SFSafariViewController). Default; the
//                   return relies on the OS routing uk.inorout.app://auth/callback
//                   to the app → native-shell's appUrlOpen → exchangeCodeForSession.
//   'authsession' — ASWebAuthenticationSession via the custom `AuthSession`
//                   native plugin (apps/inorout/ios-plugins/AuthSession/). The
//                   session returns the callback URL STRAIGHT to JS, so the code
//                   exchange happens here and DOES NOT depend on appUrlOpen /
//                   SFSafariViewController handing back a custom-scheme redirect.
//
// Why this exists: F4 re-diagnosis (s164) — web Apple sign-in works, so Apple +
// Supabase are correct; the only break is SFSafariViewController not reliably
// returning the custom-scheme *redirect* to the app. If a device rebuild with the
// scheme registered STILL shows no appUrlOpen in the Xcode console, flip this to
// 'authsession' and add the AuthSession plugin to the Xcode target. The web path
// is untouched either way.
const NATIVE_OAUTH_VIA = 'browser';

// startOAuth(provider, options)
//   provider — 'google' | 'apple'
//   options  — the exact options object the caller would pass to
//              signInWithOAuth on the web (e.g. { redirectTo }). On web it is
//              forwarded untouched; on native redirectTo + skipBrowserRedirect
//              are overridden for the deep-link flow.
// Returns the { data, error } shape signInWithOAuth returns, so existing call
// sites that read `error` keep working.
export async function startOAuth(provider, options = {}) {
  // NATIVE Sign in with Apple — the robust path. Uses the OS Apple sheet + an
  // identity token (signInWithIdToken), NOT a webview OAuth redirect: no system
  // browser, no #access_token hash, no /auth/callback round-trip, no cookie/storage
  // race at login — it eliminates the whole class of WKWebView auth fragility.
  //
  // Gate on isNativeApp() ALONE — NOT on Capacitor.isPluginAvailable('SignInWithApple').
  // Both `isPluginAvailable` and `isNativePlatform()` read the Capacitor native
  // BRIDGE, which the remote-server.url WKWebView injects late on a cold launch.
  // App Review build 1.0(5) FAILED here: the reviewer's fast/cold tap hit the gate
  // before the bridge was up → isPluginAvailable was false → it silently fell
  // through to the web OAuth flow below, which can't complete its return inside the
  // wrapper → "Sign in with Apple returned an error" (confirmed from the live auth
  // logs: the reviewer's taps hit /authorize?provider=apple, the WEB path, and never
  // returned). isNativeApp() keys off the appendUserAgent UA marker FIRST, which is
  // baked into the binary and present from the first line of JS — bridge-independent.
  // The plugin is LINKED in every native build from 1.0(5) on, so once we know we're
  // native, native Sign in with Apple is the right path; if the plugin call fails it
  // surfaces a real error (startAppleNative's catch) rather than silently dropping to
  // the broken web flow — a build/runtime problem fails loudly in test, never in review.
  // On web isNativeApp() is false (no marker, no bridge) → the unchanged web path runs.
  if (provider === 'apple' && isNativeApp()) {
    return startAppleNative(options);
  }

  // WEB / PWA — unchanged full-page redirect.
  if (!isNativeApp()) {
    return supabase.auth.signInWithOAuth({ provider, options });
  }

  // NATIVE — fallback opener takes the whole round-trip (open + return + exchange).
  if (NATIVE_OAUTH_VIA === 'authsession') return startOAuthViaAuthSession(provider, options);

  // NATIVE (default) — open the provider URL in the system browser, return via
  // deep link. Lazy import: @capacitor/browser is a native plugin; keep it off
  // the web path. The return is handled by native-shell's appUrlOpen listener.
  const { Browser } = await import('@capacitor/browser');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { ...options, redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (!error && data?.url) await Browser.open({ url: data.url });
  return { data, error };
}

// --- Native Sign in with Apple (identity-token flow) ---------------------------
// A cryptographically-random raw nonce + its SHA-256 hash. Apple embeds the HASHED
// nonce in the identity token; Supabase verifies it against the RAW nonce we pass to
// signInWithIdToken — the replay protection the provider requires. Web Crypto is
// available in the WKWebView.
function generateRawNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Drive the OS Apple sheet, exchange the returned identity token for a Supabase
// session IN PLACE, then hand off to /auth/callback so the returnTo + profile-update
// + breadcrumb-clear logic is shared byte-for-byte with the web sign-in flow.
// Returns the { data, error } shape the callers already handle.
async function startAppleNative(options = {}) {
  try {
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
    const rawNonce = generateRawNonce();
    const hashedNonce = await sha256Hex(rawNonce);
    const { response } = await SignInWithApple.authorize({
      clientId: APPLE_NATIVE_CLIENT_ID,         // iOS ignores this; documents the audience
      redirectURI: options.redirectTo || `${location.origin}/auth/callback`, // iOS ignores this
      scopes: 'name email',
      nonce: hashedNonce,
    });
    if (!response?.identityToken) {
      return { data: null, error: new Error('No identity token returned by Apple') };
    }
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: response.identityToken,
      nonce: rawNonce,
    });
    if (error) return { data, error };
    // Session is live in storage. Route through the shared callback screen, which
    // resolves returnTo and finishes immediately (getSession already has the user).
    window.location.assign('/auth/callback');
    return { data, error: null };
  } catch (e) {
    // User dismissed the sheet, or a native/exchange error — surface it like the web
    // path so the caller's `if (error)` shows a message instead of failing silently.
    return { data: null, error: e };
  }
}

// DORMANT (Stage 5.3 / F4 fallback). Open the provider URL in
// ASWebAuthenticationSession via the custom `AuthSession` native plugin, which
// resolves with the final callback URL (uk.inorout.app://auth/callback?code=…)
// DIRECTLY — no reliance on appUrlOpen or SFSafariViewController returning a
// custom-scheme redirect. The PKCE verifier was stored in THIS webview by
// signInWithOAuth(skipBrowserRedirect:true), so exchangeCodeForSession succeeds
// here exactly as it does in native-shell's appUrlOpen path. Activate by setting
// NATIVE_OAUTH_VIA='authsession' above + adding the plugin to the Xcode target
// (see apps/inorout/ios-plugins/AuthSession/README.md). Never reached on web.
async function startOAuthViaAuthSession(provider, options) {
  const { registerPlugin } = await import('@capacitor/core');
  const AuthSession = registerPlugin('AuthSession');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { ...options, redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) return { data, error };
  if (!data?.url) return { data, error: new Error('No provider URL from signInWithOAuth') };

  try {
    // Native plugin opens ASWebAuthenticationSession and resolves once the OS
    // captures the callbackURLScheme redirect. { url } is the full callback URL.
    const { url: callbackUrl } = await AuthSession.start({
      url: data.url,
      scheme: NATIVE_AUTH_SCHEME,
    });
    const parsed = new URL(callbackUrl);
    const errParam = parsed.searchParams.get('error');
    if (errParam) return { data, error: new Error(errParam) };
    const code = parsed.searchParams.get('code');
    if (code) await supabase.auth.exchangeCodeForSession(code);
    return { data, error: null };
  } catch (e) {
    return { data, error: e };
  }
}
