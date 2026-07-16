// Native shell bridge — only does anything inside the Capacitor wrapper.
// On the web (PWA / browser) every call here is a guarded no-op, so this
// module is safe to import unconditionally from main.jsx.
//
// Responsibilities:
//   2.2  status bar style/colour + hide the splash once the WebView is up
//   2.4  Android hardware back button → WebView history (exit at the root)
//   3.4  appUrlOpen deep links → route the opened path into the remote app
//
// The status-bar / splash background is the shared app-shell near-black,
// pulled from the @platform/core palette (the only hygiene-exempt home for
// hex literals) so it can never drift from index.html theme-color.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { colors } from '@platform/core';
import { isNativeApp } from './is-native.js';

export function initNativeShell() {
  // Web build: nothing to bridge. Bail before touching any native plugin.
  if (!isNativeApp()) return;

  const platform = Capacitor.getPlatform(); // 'ios' | 'android'

  // --- Push tap → deep-link (PR #3b) -------------------------------------
  // Armed at BOOT, not when a player enables push. registerNativePush only runs on the
  // Enable tap, so anyone who turned notifications on in a previous session would have
  // no tap listener today — the overwhelmingly common case. A tap that cold-starts the
  // app must find the listener already attached, so this belongs on the boot path.
  // Lazy-imported: the plugin throws "not implemented on web", and this module is
  // imported unconditionally from main.jsx.
  import('./native-push.js')
    .then(m => m.registerPushTapListener())
    .catch(e => console.error('native shell: push tap listener failed', e));

  // --- Status bar: light icons on the near-black shell -------------------
  StatusBar.setStyle({ style: Style.Dark }).catch(console.error);
  if (platform === 'android') {
    // iOS has no settable status-bar background (it's translucent over
    // content); Android does, and we match the app shell.
    StatusBar.setBackgroundColor({ color: colors.appShell }).catch(console.error);
  }

  // --- Splash: hide once the remote WebView has had a moment to paint -----
  // launchAutoHide is false in capacitor.config so we own the timing and
  // avoid a white flash between splash and first paint of the remote site.
  setTimeout(() => {
    SplashScreen.hide().catch(console.error);
  }, 400);

  // --- Android hardware back button → WebView history --------------------
  // Default Capacitor behaviour ignores in-app history; route it through the
  // browser history so back navigates screens, and only exit at the root.
  if (platform === 'android') {
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        App.exitApp();
      }
    }).catch(console.error);
  }

  // --- Deep links: appUrlOpen → route the opened path into the WebView ----
  // 3.4. When the OS hands a universal/app link (or our custom scheme) to the
  // wrapped app — e.g. /p/<token>, /admin/<token>, /m/<token>, /signin — the
  // WebView is already pinned to https://app.in-or-out.com (server.url), so we
  // just navigate it to the path the link carried. The app re-reads
  // window.location.pathname on load (App.jsx) and routes itself from there,
  // exactly as it does for every other window.location.href navigation.
  //
  // Both transports land here with the right path: a universal/app link parses
  // as https://app.in-or-out.com/p/<token> (pathname = /p/<token>); the custom
  // scheme parses as uk.inorout.app:///p/<token> (same pathname). We take
  // pathname+search+hash from either and ignore the origin.
  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return; // unparseable — nothing safe to route to
    }

    // 3.6 / F4. OAuth / Sign-in-with-Apple return. The provider redirected to our
    // custom scheme uk.inorout.app://auth/callback with the session as EITHER a
    // ?code= query (PKCE) OR a #access_token=… hash (implicit). Apple/Supabase
    // returns the HASH form here (verified s164 device walk), which the old
    // code-only handler missed. Rather than exchange tokens in this listener,
    // route the WebView into the REAL web callback /auth/callback carrying the
    // original query AND hash: supabase's detectSessionInUrl + the AuthCallback
    // screen then establish the session and redirect to auth_return_to —
    // IDENTICAL to the proven web sign-in flow. Custom-scheme parse: host='auth',
    // pathname='/callback' (and a universal-link form would be
    // host='app.in-or-out.com', pathname='/auth/callback') — both normalise to
    // …auth/callback; we always rebuild the canonical '/auth/callback' path since
    // the WebView is already pinned to app.in-or-out.com (server.url).
    const hash = parsed.hash || '';
    const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
    const hostPath = `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
    // ANY return to auth/callback is an auth return — always dismiss the system
    // browser and hand off to the web callback, even when the param shape isn't the
    // expected code/access_token/error (e.g. token_hash, or an error carried only as
    // error_description). Previously a non-matching shape fell through to generic
    // routing WITHOUT closing the browser, leaving the Safari sheet covering the app.
    const isAuthReturn = hostPath.endsWith('auth/callback');
    if (isAuthReturn) {
      // Dismiss the system browser, then hand the response to the web callback.
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close().catch(() => {});
      } catch (e) {
        console.error(e);
      }
      window.location.replace('/auth/callback' + parsed.search + hash);
      return;
    }

    const path = parsed.pathname + parsed.search + parsed.hash;
    // Bare host / empty path: let the app keep whatever it's showing.
    if (!path || path === '/') return;
    // Already on that exact path: don't trigger a needless reload.
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (path === current) return;
    window.location.href = path;
  }).catch(console.error);
}
