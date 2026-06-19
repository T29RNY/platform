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

import { Capacitor } from '@capacitor/core';
import { supabase } from '@platform/core/storage/supabase.js';

// The custom-scheme deep link the provider redirects back to. Must match the
// scheme the native build registers and the Supabase Auth redirect allowlist.
export const NATIVE_AUTH_REDIRECT = 'uk.inorout.app://auth/callback';

// startOAuth(provider, options)
//   provider — 'google' | 'apple'
//   options  — the exact options object the caller would pass to
//              signInWithOAuth on the web (e.g. { redirectTo }). On web it is
//              forwarded untouched; on native redirectTo + skipBrowserRedirect
//              are overridden for the deep-link flow.
// Returns the { data, error } shape signInWithOAuth returns, so existing call
// sites that read `error` keep working.
export async function startOAuth(provider, options = {}) {
  // WEB / PWA — unchanged full-page redirect.
  if (!Capacitor.isNativePlatform()) {
    return supabase.auth.signInWithOAuth({ provider, options });
  }

  // NATIVE — open the provider URL in the system browser, return via deep link.
  // Lazy import: @capacitor/browser is a native plugin; keep it off the web path.
  const { Browser } = await import('@capacitor/browser');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { ...options, redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (!error && data?.url) await Browser.open({ url: data.url });
  return { data, error };
}
